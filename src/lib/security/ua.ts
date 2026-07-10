// Lightweight User-Agent + request info parsing for real login tracking.
// 🔌 Production: use a dedicated UA parser (e.g. `ua-parser-js`) + a GeoIP
//    service (MaxMind / ipinfo) for accurate device & location.

export interface ClientInfo {
  device: string;
  browser: string;
  ip: string;
  location: string;
}

export function parseUserAgent(ua: string): { device: string; browser: string } {
  let browser = "未知浏览器";
  const edg = ua.match(/Edg\/(\d+)/);
  const chrome = ua.match(/Chrome\/(\d+)/);
  const fx = ua.match(/Firefox\/(\d+)/);
  if (edg) browser = `Edge ${edg[1]}`;
  else if (chrome) browser = `Chrome ${chrome[1]}`;
  else if (fx) browser = `Firefox ${fx[1]}`;
  else if (/Safari\//.test(ua) && !chrome) browser = "Safari";

  let device = "未知设备";
  if (/iPhone/.test(ua)) device = "iPhone";
  else if (/iPad/.test(ua)) device = "iPad";
  else if (/Android/.test(ua)) device = "Android 设备";
  else if (/Macintosh|Mac OS X/.test(ua)) device = "Mac";
  else if (/Windows/.test(ua)) device = "Windows PC";
  else if (/Linux/.test(ua)) device = "Linux 设备";
  return { device, browser };
}

function isLocalIp(ip: string): boolean {
  return /^(127\.|::1|localhost|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|本地)/.test(ip);
}

export function clientInfoFromRequest(req: Request): ClientInfo {
  const ua = req.headers.get("user-agent") ?? "";
  const { device, browser } = parseUserAgent(ua);
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip")?.trim() ||
    "本地";
  const location = isLocalIp(ip) ? "本地网络" : "未知地区";
  return { device, browser, ip, location };
}
