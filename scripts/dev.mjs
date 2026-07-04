import { spawn } from "node:child_process";

const children = [
  spawn("npm", ["run", "dev", "-w", "@harnesshub/api"], { stdio: "inherit" }),
  spawn("npm", ["run", "dev", "-w", "@harnesshub/registry-web"], { stdio: "inherit" })
];

for (const child of children) {
  child.on("exit", (code) => {
    if (code && code !== 0) {
      for (const other of children) other.kill("SIGTERM");
      process.exit(code);
    }
  });
}

process.on("SIGINT", () => {
  for (const child of children) child.kill("SIGINT");
  process.exit(0);
});
