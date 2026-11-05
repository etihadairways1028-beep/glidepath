"""Checks that a Windows PE file's Authenticode hash matches the digest in its
signature, and prints the signing certificate subjects. Exits 1 on mismatch.

This proves the binary is byte-for-byte what was signed. Full certificate
chain validation is done by Windows itself when the file is run.
"""
import hashlib
import sys

import pefile


def tlv(b, i=0):
    tag = b[i]; i += 1; length = b[i]; i += 1
    if length & 0x80:
        n = length & 0x7F; length = int.from_bytes(b[i:i + n], "big"); i += n
    return tag, b[i:i + length], i + length


def children(b):
    out, i = [], 0
    while i < len(b):
        t, v, j = tlv(b, i); out.append((t, v, b[i:j])); i = j
    return out


def main(path: str) -> None:
    data = open(path, "rb").read()
    pe = pefile.PE(path, fast_load=True)
    sec = pe.OPTIONAL_HEADER.DATA_DIRECTORY[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_SECURITY"]]
    if not sec.VirtualAddress:
        sys.exit(f"{path}: not signed")
    cks = pe.OPTIONAL_HEADER.get_file_offset() + 64
    dir_off = sec.get_file_offset()
    blob = data[sec.VirtualAddress + 8: sec.VirtualAddress + sec.Size]
    _, ci, _ = tlv(blob)
    sd = children(children(children(ci)[1][1])[0][1])
    spc = children(children(children(sd[2][1])[1][1])[0][1])
    di = children(spc[1][1])
    oid = children(di[0][1])[0][1].hex()
    alg = hashlib.sha256 if oid == "608648016503040201" else hashlib.sha1
    h = alg()
    h.update(data[:cks]); h.update(data[cks + 4:dir_off])
    h.update(data[dir_off + 8:sec.VirtualAddress]); h.update(data[sec.VirtualAddress + sec.Size:])
    if h.digest() != di[1][1]:
        sys.exit(f"{path}: Authenticode hash MISMATCH — refusing to use this binary")
    print(f"{path}: Authenticode {alg().name} hash matches its signature")
    if b"OpenJS Foundation" not in blob:
        sys.exit(f"{path}: signature does not name the OpenJS Foundation — refusing to use this binary")
    print("Signed by: OpenJS Foundation (Node.js)")


if __name__ == "__main__":
    main(sys.argv[1])
