const dir = "build/npm/esm";
const results: Array<{ file: string; size: number }> = [];

for await (const entry of Deno.readDir(dir)) {
  if (!entry.isFile) continue;
  let path = `${dir}/${entry.name}`;
  let { size } = await Deno.stat(path);
  results.push({ file: entry.name, size });
}

results.sort((a, b) => a.file.localeCompare(b.file));
console.log(JSON.stringify(results));
