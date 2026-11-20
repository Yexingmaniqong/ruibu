package app.mindnote;

import android.content.res.AssetManager;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import org.json.JSONObject;
import org.json.JSONException;
import java.util.HashMap;
import java.util.Map;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import javax.net.ssl.HttpsURLConnection;

/**
 * 极简 HTTP 服务（只给 App 自己的 WebView 用）：
 *  · 静态文件从 APK 的 assets 里读（网页版本体）
 *  · /api/snapshot 读写本地数据文件，行为和电脑上的 sync-server.js 一致
 *  · /api/ai 转发 DeepSeek（WebView 里直连会被跨域拦掉）
 */
public class MiniServer {

    private final AssetManager assets;
    private final File dataFile;
    private final int port;
    private ServerSocket socket;
    private volatile boolean running = false;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private static final Map<String, String> MIME = new HashMap<String, String>();

    static {
        MIME.put("html", "text/html; charset=utf-8");
        MIME.put("js", "application/javascript; charset=utf-8");
        MIME.put("css", "text/css; charset=utf-8");
        MIME.put("json", "application/json; charset=utf-8");
        MIME.put("webmanifest", "application/manifest+json; charset=utf-8");
        MIME.put("svg", "image/svg+xml");
        MIME.put("png", "image/png");
        MIME.put("jpg", "image/jpeg");
        MIME.put("jpeg", "image/jpeg");
        MIME.put("webp", "image/webp");
        MIME.put("ico", "image/x-icon");
        MIME.put("woff2", "font/woff2");
        MIME.put("woff", "font/woff");
        MIME.put("ttf", "font/ttf");
        MIME.put("txt", "text/plain; charset=utf-8");
    }

    public MiniServer(AssetManager assets, File dataFile, int port) {
        this.assets = assets;
        this.dataFile = dataFile;
        this.port = port;
    }

    /** 首次运行把随包的种子数据放到 files 目录 */
    public void seedIfNeeded() {
        try {
            if (dataFile.exists() && dataFile.length() > 2) return;
            byte[] seed = readAsset("sync-data.json");
            FileOutputStream out = new FileOutputStream(dataFile);
            out.write(seed);
            out.close();
        } catch (IOException e) {
            // 没有种子也能用
        }
    }

    public void start() throws IOException {
        seedIfNeeded();
        socket = new ServerSocket();
        socket.setReuseAddress(true);
        socket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"), port));
        running = true;
        Thread t = new Thread(this::acceptLoop, "mindnote-http");
        t.setDaemon(true);
        t.start();
    }

    public void stop() {
        running = false;
        try {
            if (socket != null) socket.close();
        } catch (IOException ignored) {
        }
        pool.shutdownNow();
    }

    private void acceptLoop() {
        while (running) {
            try {
                final Socket client = socket.accept();
                pool.execute(() -> handle(client));
            } catch (IOException e) {
                if (!running) return;
            }
        }
    }

    private void handle(Socket client) {
        try {
            InputStream in = client.getInputStream();
            String head = readHead(in);
            if (head == null) {
                client.close();
                return;
            }
            String[] lines = head.split("\r\n");
            String[] first = lines[0].split(" ");
            if (first.length < 2) {
                client.close();
                return;
            }
            String method = first[0];
            String path = first[1];
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);
            if (path.equals("/") || path.isEmpty()) path = "/index.html";

            int contentLength = 0;
            for (int i = 1; i < lines.length; i++) {
                String l = lines[i];
                int c = l.indexOf(':');
                if (c > 0 && l.substring(0, c).trim().equalsIgnoreCase("Content-Length")) {
                    try {
                        contentLength = Integer.parseInt(l.substring(c + 1).trim());
                    } catch (NumberFormatException ignored) {
                    }
                }
            }

            OutputStream out = client.getOutputStream();

            if (path.startsWith("/api/")) {
                handleApi(method, path, in, contentLength, out);
                out.flush();
                client.close();
                return;
            }

            byte[] body;
            try {
                body = readAsset(path.substring(1));
            } catch (IOException e) {
                byte[] nf = "404 Not Found".getBytes("UTF-8");
                writeHead(out, "404 Not Found", "text/plain; charset=utf-8", nf.length, "no-store");
                out.write(nf);
                out.flush();
                client.close();
                return;
            }
            String mime = mimeOf(path);
            boolean code = mime.contains("javascript") || mime.contains("html")
                    || mime.contains("css") || mime.contains("json") || mime.contains("font");
            writeHead(out, "200 OK", mime, body.length, code ? "no-store" : "public, max-age=86400");
            out.write(body);
            out.flush();
            client.close();
        } catch (Exception e) {
            try {
                client.close();
            } catch (IOException ignored) {
            }
        }
    }

    /* ---------------- /api/* ---------------- */
    private void handleApi(String method, String path, InputStream in, int len, OutputStream out) throws IOException {
        if (path.equals("/api/ping")) {
            byte[] b = "{\"app\":\"mindnote-sync\",\"version\":1,\"notes\":0,\"images\":0}".getBytes("UTF-8");
            writeHead(out, "200 OK", "application/json; charset=utf-8", b.length, "no-store");
            out.write(b);
            return;
        }

        if (path.equals("/api/snapshot")) {
            if ("POST".equalsIgnoreCase(method)) {
                byte[] body = readBody(in, len);
                writeFile(dataFile, body);
                writeHead(out, "200 OK", "application/json; charset=utf-8", body.length, "no-store");
                out.write(body);
                return;
            }
            byte[] cur = readFile(dataFile);
            if (cur == null || cur.length < 2) {
                cur = "{\"state\":{\"version\":1,\"notes\":[],\"boards\":[],\"tomb\":{},\"ui\":{}},\"images\":{}}".getBytes("UTF-8");
            }
            writeHead(out, "200 OK", "application/json; charset=utf-8", cur.length, "no-store");
            out.write(cur);
            return;
        }

        if (path.equals("/api/ai")) {
            if (!"POST".equalsIgnoreCase(method)) {
                byte[] e = "{\"error\":{\"message\":\"method not allowed\"}}".getBytes("UTF-8");
                writeHead(out, "405 Method Not Allowed", "application/json; charset=utf-8", e.length, "no-store");
                out.write(e);
                return;
            }
            if (len <= 0 || len > 12 * 1024 * 1024) {
                byte[] error = "{\"error\":{\"message\":\"请求为空或图片数据过大\"}}".getBytes("UTF-8");
                writeHead(out, "413 Payload Too Large", "application/json; charset=utf-8", error.length, "no-store");
                out.write(error);
                return;
            }
            relayAIRequest(new String(readBody(in, len), "UTF-8"), out);
            return;
        }

        byte[] nf = "{}".getBytes("UTF-8");
        writeHead(out, "404 Not Found", "application/json; charset=utf-8", nf.length, "no-store");
        out.write(nf);
    }

    private void relayAIRequest(String json, OutputStream out) throws IOException {
        try {
            JSONObject request = new JSONObject(json);
            String provider = request.optString("provider", "deepseek");
            String endpoint;
            switch (provider) {
                case "deepseek": endpoint = "https://api.deepseek.com/chat/completions"; break;
                case "openai": endpoint = "https://api.openai.com/v1/chat/completions"; break;
                case "anthropic": endpoint = "https://api.anthropic.com/v1/messages"; break;
                case "doubao": endpoint = "https://ark.cn-beijing.volces.com/api/v3/chat/completions"; break;
                case "xai": endpoint = "https://api.x.ai/v1/chat/completions"; break;
                default: throw new JSONException("Unknown provider");
            }
            String key = request.getString("key");
            JSONObject payload = request.optJSONObject("payload");
            if (payload == null && "deepseek".equals(provider)) {
                request.remove("key");
                request.remove("provider");
                payload = request;
            }
            if (key.isEmpty() || payload == null || payload.optString("model").isEmpty()
                    || payload.optJSONArray("messages") == null) throw new JSONException("Missing API parameters");
            relayAI(endpoint, "anthropic".equals(provider), payload.toString(), key, out);
        } catch (JSONException invalid) {
            byte[] error = "{\"error\":{\"message\":\"AI 服务、密钥或请求格式不正确\"}}".getBytes("UTF-8");
            writeHead(out, "400 Bad Request", "application/json; charset=utf-8", error.length, "no-store");
            out.write(error);
        }
    }

    private void relayAI(String endpoint, boolean anthropic, String payload, String key, OutputStream out) {
        HttpURLConnection conn = null;
        byte[] resp = null;
        int code = 502;
        try {
            URL u = new URL(endpoint);
            conn = (HttpURLConnection) u.openConnection();
            if (conn instanceof HttpsURLConnection) {
                ((HttpsURLConnection) conn).setSSLSocketFactory(((HttpsURLConnection) conn).getSSLSocketFactory());
            }
            conn.setRequestMethod("POST");
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
            conn.setInstanceFollowRedirects(false);
            if (anthropic) {
                conn.setRequestProperty("x-api-key", key);
                conn.setRequestProperty("anthropic-version", "2023-06-01");
            } else conn.setRequestProperty("Authorization", "Bearer " + key);
            conn.setDoOutput(true);
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(120000);
            byte[] body = payload.getBytes("UTF-8");
            conn.setFixedLengthStreamingMode(body.length);
            OutputStream os = conn.getOutputStream();
            os.write(body);
            os.flush();
            os.close();
            code = conn.getResponseCode();
            InputStream is = (code >= 400) ? conn.getErrorStream() : conn.getInputStream();
            resp = readAll(is);
        } catch (Exception e) {
            resp = "{\"error\":{\"message\":\"无法连接所选 AI 服务\"}}".getBytes(java.nio.charset.StandardCharsets.UTF_8);
            code = 502;
        } finally {
            if (conn != null) conn.disconnect();
        }
        if (resp == null || resp.length == 0) {
            resp = "{\"error\":{\"message\":\"空响应\"}}".getBytes();
            code = 502;
        }
        String status = (code == 200) ? "200 OK" : (code + " Upstream");
        try {
            writeHead(out, status, "application/json; charset=utf-8", resp.length, "no-store");
            out.write(resp);
        } catch (IOException ignored) {
        }
    }

    private static byte[] readAll(InputStream is) throws IOException {
        if (is == null) return new byte[0];
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        byte[] tmp = new byte[8192];
        int n;
        while ((n = is.read(tmp)) > 0) buf.write(tmp, 0, n);
        is.close();
        return buf.toByteArray();
    }

    /** 取 JSON 里第一个 "key":"…" 的值 */
    private static String extractJsonString(String json, String name) {
        Matcher m = Pattern.compile("\"" + name + "\"\\s*:\\s*\"([^\"]*)\"").matcher(json);
        return m.find() ? m.group(1) : null;
    }

    /** 去掉顶层 "key" 字段（DeepSeek 不认这个字段），只在开头/结尾匹配，避免误伤正文 */
    private static String stripKey(String json) {
        String s = json.replaceFirst("^\\{\\s*\"key\"\\s*:\\s*\"[^\"]*\"\\s*,", "{");
        if (!s.equals(json)) return s;
        return json.replaceFirst(",\\s*\"key\"\\s*:\\s*\"[^\"]*\"\\s*\\}", "}");
    }

    /* ---------------- 基础工具 ---------------- */
    /** 读到 \r\n\r\n 为止（头部很小，逐字节读即可，body 留在流里） */
    private static String readHead(InputStream in) throws IOException {
        ByteArrayOutputStream buf = new ByteArrayOutputStream();
        int matched = 0;
        int b;
        while ((b = in.read()) != -1) {
            buf.write(b);
            if (b == 13) {
                matched = (matched == 2) ? 3 : 1;
            } else if (b == 10 && matched == 1) {
                matched = 2;
            } else if (b == 10 && matched == 3) {
                break;
            } else {
                matched = 0;
            }
            if (buf.size() > 65536) break;
        }
        if (buf.size() == 0) return null;
        return new String(buf.toByteArray(), "UTF-8");
    }

    private static byte[] readBody(InputStream in, int len) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] tmp = new byte[8192];
        int left = len;
        while (left > 0) {
            int n = in.read(tmp, 0, Math.min(tmp.length, left));
            if (n < 0) break;
            out.write(tmp, 0, n);
            left -= n;
        }
        return out.toByteArray();
    }

    private void writeHead(OutputStream out, String status, String mime, int len, String cache) throws IOException {
        String h = "HTTP/1.1 " + status + "\r\n" +
                "Content-Type: " + mime + "\r\n" +
                "Content-Length: " + len + "\r\n" +
                "Cache-Control: " + cache + "\r\n" +
                "Access-Control-Allow-Origin: *\r\n" +
                "Connection: close\r\n\r\n";
        out.write(h.getBytes("UTF-8"));
    }

    private byte[] readAsset(String path) throws IOException {
        InputStream in = assets.open(path);
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] tmp = new byte[16384];
            int n;
            while ((n = in.read(tmp)) > 0) out.write(tmp, 0, n);
            return out.toByteArray();
        } finally {
            in.close();
        }
    }

    private static String mimeOf(String path) {
        int dot = path.lastIndexOf('.');
        if (dot < 0) return "application/octet-stream";
        String ext = path.substring(dot + 1).toLowerCase();
        String m = MIME.get(ext);
        return m == null ? "application/octet-stream" : m;
    }

    private static byte[] readFile(File f) {
        if (!f.exists()) return null;
        try {
            FileInputStream in = new FileInputStream(f);
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] tmp = new byte[16384];
            int n;
            while ((n = in.read(tmp)) > 0) out.write(tmp, 0, n);
            in.close();
            return out.toByteArray();
        } catch (IOException e) {
            return null;
        }
    }

    private static void writeFile(File f, byte[] data) {
        try {
            File parent = f.getParentFile();
            if (parent != null && !parent.exists()) parent.mkdirs();
            FileOutputStream out = new FileOutputStream(f);
            out.write(data);
            out.close();
        } catch (IOException ignored) {
        }
    }
}
