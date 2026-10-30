"""Make a copied macOS Node executable independent of Homebrew dylib paths."""
import os
from pathlib import Path
import shutil
import subprocess
import sys

binary = Path(sys.argv[1]).resolve()
libdir = binary.parent / 'lib'
libdir.mkdir(exist_ok=True)
seen = set()

def bundle(target, original):
    if target in seen:
        return
    seen.add(target)
    target.chmod(target.stat().st_mode | 0o200)
    output = subprocess.check_output(['otool', '-L', str(target)], text=True)
    for line in output.splitlines()[1:]:
        dependency = line.strip().split(' (')[0]
        if dependency.startswith('@loader_path/'):
            source = original.parent / dependency.removeprefix('@loader_path/')
        elif dependency.startswith('@rpath/'):
            source = original.parent / dependency.removeprefix('@rpath/')
        elif dependency.startswith(('/opt/', '/usr/local/')):
            source = Path(dependency)
        else:
            continue
        copied = libdir / source.name
        if copied != target and copied not in seen:
            shutil.copy2(source, copied)
            bundle(copied, source)
        replacement = '@loader_path/' + ('lib/' if target == binary else '') + source.name
        subprocess.run(['install_name_tool', '-change', dependency, replacement, str(target)], check=True)
    if target != binary:
        subprocess.run(['install_name_tool', '-id', '@loader_path/' + target.name, str(target)], check=True)
    subprocess.run(['codesign', '--force', '--sign', '-', str(target)], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

bundle(binary, Path(sys.argv[2]).resolve())
