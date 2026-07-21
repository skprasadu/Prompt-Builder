function pathSepFor(pathValue: string): "/" | "\\" {
  return pathValue.includes("\\") ? "\\" : "/";
}

export function toRelative(root: string, absolute: string): string {
  const sep = pathSepFor(root);
  const rootNorm = root.endsWith(sep) ? root : root + sep;

  if (absolute.startsWith(rootNorm)) {
    return absolute.slice(rootNorm.length);
  }

  const absFix = absolute.split(/[\\/]+/).join(sep);
  const rootFix = rootNorm.split(/[\\/]+/).join(sep);

  return absFix.startsWith(rootFix) ? absFix.slice(rootFix.length) : absolute;
}

export function toAbsolute(root: string, relative: string): string {
  const sep = pathSepFor(root);
  const relNorm = relative.split(/[\\/]+/).join(sep);

  return (root.endsWith(sep) ? root : root + sep) + relNorm;
}
