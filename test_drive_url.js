const { extractDriveFileId } = require("./src/fileExtraction");

const cases = [
  ["https://drive.google.com/open?id=1AbC23dEfGhIjKlmNoP", "1AbC23dEfGhIjKlmNoP"],
  ["https://drive.google.com/file/d/9ZzY88xWvUtSrQ/view?usp=drivesdk", "9ZzY88xWvUtSrQ"],
  ["https://drive.google.com/file/d/abc123/view", "abc123"],
  [null, null],
  ["", null]
];

for (const [input, expected] of cases) {
  const result = extractDriveFileId(input);
  console.log(JSON.stringify(input), "->", result);
  if (result !== expected) throw new Error(`FAILED for ${input}: expected ${expected}, got ${result}`);
}

console.log("\nAll Drive URL parsing assertions passed.");
