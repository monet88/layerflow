import socket
import ipaddress
import logging
from urllib.parse import urlparse

logger = logging.getLogger("app.core.url_security")

def is_safe_url(url: str) -> bool:
    """Validate that a URL uses http/https and does not resolve to local/internal IP addresses.

    This prevents SSRF and Local File Inclusion (LFI) attacks by resolving
    the domain name and checking all associated IP addresses.
    """
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            logger.warning("Unsafe URL scheme: %s in %s", parsed.scheme, url)
            return False

        hostname = parsed.hostname
        if not hostname:
            logger.warning("Missing hostname in URL: %s", url)
            return False

        # Resolve IP addresses for the hostname
        try:
            addr_info = socket.getaddrinfo(hostname, None)
        except socket.gaierror as exc:
            logger.warning("Failed to resolve hostname %s: %s", hostname, exc)
            return False

        for family, _, _, _, sockaddr in addr_info:
            ip_str = sockaddr[0]
            try:
                ip = ipaddress.ip_address(ip_str)
            except ValueError:
                # If it's not a valid IP address format, skip or reject
                continue

            if ip.is_loopback:
                logger.warning("SSRF block: Loopback IP detected for %s", hostname)
                return False
            if ip.is_private:
                logger.warning("SSRF block: Private IP detected for %s", hostname)
                return False
            if ip.is_link_local:
                logger.warning("SSRF block: Link-local IP detected for %s", hostname)
                return False
            if ip.is_unspecified:
                logger.warning("SSRF block: Unspecified IP detected for %s", hostname)
                return False

        return True
    except Exception as exc:
        logger.exception("Error validating URL safety: %s", exc)
        return False
