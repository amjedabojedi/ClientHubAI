import dns from "dns";

// Force DNS to use Cloudflare / Google DNS
dns.setServers(["1.1.1.1", "8.8.8.8"]);
