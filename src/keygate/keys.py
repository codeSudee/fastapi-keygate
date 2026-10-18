"""Key generation and hashing.

Keys look like ``kg_<prefix>_<secret>``. Only the SHA-256 of the full key and
the (non-secret) prefix are stored. SHA-256 is sufficient because keys are
high-entropy random strings, not human passwords.
"""

import hashlib
import hmac
import secrets
from typing import Optional, Tuple

KEY_TAG = "kg"


def generate_key() -> Tuple[str, str, str]:
    """Return ``(plaintext_key, prefix, key_hash)``."""
    prefix = secrets.token_hex(4)
    key = f"{KEY_TAG}_{prefix}_{secrets.token_urlsafe(32)}"
    return key, prefix, hash_key(key)


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def parse_prefix(key: str) -> Optional[str]:
    """Extract the lookup prefix from a presented key, or None if malformed."""
    parts = key.split("_", 2)
    if len(parts) != 3 or parts[0] != KEY_TAG or not parts[1] or not parts[2]:
        return None
    return parts[1]


def verify_key(key: str, key_hash: str) -> bool:
    return hmac.compare_digest(hash_key(key), key_hash)
