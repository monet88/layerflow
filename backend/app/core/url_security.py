import socket
import ipaddress
import logging
from urllib.parse import urlparse

logger = logging.getLogger("app.core.url_security")

from typing import Tuple, List

def validate_and_resolve_url(url: str) -> Tuple[bool, List[str]]:
    """Validate that a URL uses http/https, does not resolve to local/internal IP addresses,
    and returns (is_safe, resolved_ip_list).

    Fails closed if any IP cannot be parsed or resolves to loopback/private/link-local ranges.
    """
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            logger.warning("Unsafe URL scheme: %s in %s", parsed.scheme, url)
            return False, []

        hostname = parsed.hostname
        if not hostname:
            logger.warning("Missing hostname in URL: %s", url)
            return False, []

        # Resolve IP addresses for the hostname using TCP stream sockets
        try:
            addr_info = socket.getaddrinfo(hostname, None, type=socket.SOCK_STREAM)
        except socket.gaierror as exc:
            logger.warning("Failed to resolve hostname %s: %s", hostname, exc)
            return False, []

        resolved_ips = []
        for family, _, _, _, sockaddr in addr_info:
            ip_str = sockaddr[0]
            try:
                ip = ipaddress.ip_address(ip_str)
                # Unpack IPv4-mapped or IPv4-compatible IPv6 addresses
                if isinstance(ip, ipaddress.IPv6Address):
                    if ip.ipv4_mapped:
                        ip = ip.ipv4_mapped
                    elif ip.packed[:12] == b'\x00' * 12:
                        ip = ipaddress.IPv4Address(ip.packed[12:])

                if not ip.is_global:
                    logger.warning("SSRF block: Unsafe or non-global IP detected for %s: %s", hostname, ip_str)
                    return False, []
            except ValueError:
                logger.warning("SSRF block: Failed to parse IP address format %s for %s", ip_str, hostname)
                return False, []

            normalized_ip = str(ip)
            if normalized_ip not in resolved_ips:
                resolved_ips.append(normalized_ip)

        if not resolved_ips:
            return False, []

        return True, resolved_ips
    except Exception as exc:
        logger.exception("Error validating URL safety: %s", exc)
        return False, []

def is_safe_url(url: str) -> bool:
    """Validate that a URL uses http/https and does not resolve to local/internal IP addresses.

    This prevents SSRF and Local File Inclusion (LFI) attacks by resolving
    the domain name and checking all associated IP addresses.
    """
    safe, _ = validate_and_resolve_url(url)
    return safe
