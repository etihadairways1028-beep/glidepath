"""Copies a PE file without its Authenticode signature. Injecting the SEA blob
invalidates the original signature anyway; a release build is re-signed
with Glidepath's own code-signing certificate."""
import sys

import pefile

src, dst = sys.argv[1], sys.argv[2]
pe = pefile.PE(src)
sec = pe.OPTIONAL_HEADER.DATA_DIRECTORY[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_SECURITY"]]
start = sec.VirtualAddress
sec.VirtualAddress = 0
sec.Size = 0
data = pe.write()
open(dst, "wb").write(data[:start] if start else data)
print(f"Unsigned copy written to {dst}")
