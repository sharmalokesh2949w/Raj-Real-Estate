const readline = require("node:readline/promises");
const path = require("node:path");
const { stdin, stdout } = require("node:process");
require("dotenv").config({ path: path.resolve(__dirname, "..", ".env") });
const { registerAdmin } = require("../cms/auth");
const { db, databasePath } = require("../cms/database");

async function promptPassword(label) {
    if (!stdin.isTTY || typeof stdin.setRawMode !== "function") {
        throw new Error("Run this command in an interactive terminal so the password can be entered privately.");
    }

    stdout.write(label);
    stdin.setRawMode(true);
    stdin.resume();

    return new Promise((resolve, reject) => {
        let value = "";
        const finish = (error) => {
            stdin.removeListener("data", onData);
            stdin.setRawMode(false);
            stdin.pause();
            stdout.write("\n");
            if (error) reject(error);
            else resolve(value);
        };
        const onData = chunk => {
            for (const character of chunk.toString("utf8")) {
                if (character === "\u0003") {
                    finish(new Error("Administrator setup cancelled."));
                    return;
                }
                if (character === "\r" || character === "\n") {
                    finish();
                    return;
                }
                if (character === "\u007f" || character === "\b") {
                    if (value) {
                        value = value.slice(0, -1);
                        stdout.write("\b \b");
                    }
                    continue;
                }
                if (character >= " " && character !== "\u007f" && value.length < 256) {
                    value += character;
                    stdout.write("*");
                }
            }
        };
        stdin.on("data", onData);
    });
}

async function main() {
    const prompts = readline.createInterface({ input: stdin, output: stdout });
    const email = (await prompts.question("Administrator email: ")).trim();
    prompts.close();

    const password = await promptPassword("Administrator password (12+ characters): ");
    const confirmation = await promptPassword("Confirm password: ");
    if (password !== confirmation) throw new Error("Passwords do not match.");

    registerAdmin(email, password);
    stdout.write(`Administrator account created in ${databasePath}.\n`);
}

main()
    .catch(error => {
        console.error(error.message);
        process.exitCode = 1;
    })
    .finally(() => db.close());
