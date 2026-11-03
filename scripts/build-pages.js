const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const projectRoot = path.resolve(__dirname, "..");
const publicDirectories = new Set([
    "admin",
    "css",
    "images",
    "js",
    "projects",
    "Propertys"
]);
const privateDirectories = new Set([
    ".git",
    "cms",
    "customer-data",
    "customer-uploads",
    "data",
    "functions",
    "local-data",
    "node_modules",
    "routes",
    "scripts",
    "tests",
    "uploads"
]);
const publicExtensions = new Set([
    ".css",
    ".eot",
    ".gif",
    ".html",
    ".ico",
    ".jpeg",
    ".jpg",
    ".js",
    ".json",
    ".mjs",
    ".mp4",
    ".pdf",
    ".png",
    ".svg",
    ".ttf",
    ".webm",
    ".webp",
    ".woff",
    ".woff2",
    ".xml"
]);
const privateExtensions = new Set([
    ".crt",
    ".db",
    ".key",
    ".pem",
    ".sqlite",
    ".sqlite3"
]);

function isPrivateAssetPath(relativePath) {
    const normalizedPath = relativePath.replace(/\\/g, "/");
    const segments = normalizedPath.split("/");
    const filename = segments[segments.length - 1];
    const extension = path.posix.extname(filename).toLowerCase();

    return segments.some(segment =>
        privateDirectories.has(segment.toLowerCase()) ||
        /^\.env(?:\.|$)/i.test(segment)
    ) || privateExtensions.has(extension) ||
        /\.(?:sqlite|sqlite3|db)(?:-|$)/i.test(filename);
}

function isPublicAssetPath(relativePath) {
    const normalizedPath = relativePath.replace(/\\/g, "/");
    if (!normalizedPath || isPrivateAssetPath(normalizedPath)) return false;

    if (normalizedPath === "CNAME" ||
        normalizedPath === "_headers" ||
        normalizedPath === "_redirects") {
        return true;
    }

    const segments = normalizedPath.split("/");
    if (segments.length === 1) {
        return path.posix.extname(normalizedPath).toLowerCase() === ".html";
    }
    return publicDirectories.has(segments[0]) &&
        publicExtensions.has(path.posix.extname(normalizedPath).toLowerCase());
}

function trackedFiles(rootDirectory) {
    const output = execFileSync("git", ["ls-files", "--cached", "-z"], {
        cwd: rootDirectory,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
    });
    return output.split("\0").filter(Boolean);
}

function buildPages({
    rootDirectory = projectRoot,
    outputDirectory = path.join(rootDirectory, "dist")
} = {}) {
    const resolvedRoot = path.resolve(rootDirectory);
    const resolvedOutput = path.resolve(outputDirectory);
    if (resolvedOutput === resolvedRoot ||
        !resolvedOutput.startsWith(`${resolvedRoot}${path.sep}`)) {
        throw new Error("Pages output directory must be inside the project directory.");
    }

    const outputStat = fs.existsSync(resolvedOutput)
        ? fs.lstatSync(resolvedOutput)
        : null;
    if (outputStat?.isSymbolicLink()) {
        throw new Error("Pages output directory must not be a symbolic link.");
    }
    if (outputStat && !outputStat.isDirectory()) {
        throw new Error("Pages output path exists and is not a directory.");
    }
    if (outputStat) fs.rmSync(resolvedOutput, { recursive: true, force: true });
    fs.mkdirSync(resolvedOutput, { recursive: true });

    const copiedFiles = [];
    for (const relativePath of trackedFiles(resolvedRoot)) {
        if (!isPublicAssetPath(relativePath)) continue;

        const sourcePath = path.join(resolvedRoot, ...relativePath.split("/"));
        const sourceStat = fs.lstatSync(sourcePath);
        if (!sourceStat.isFile()) continue;

        const destinationPath = path.join(resolvedOutput, ...relativePath.split("/"));
        fs.mkdirSync(path.dirname(destinationPath), { recursive: true });
        fs.copyFileSync(sourcePath, destinationPath);
        copiedFiles.push(relativePath);
    }

    if (!copiedFiles.includes("index.html")) {
        throw new Error("Pages build did not include the website index.html.");
    }
    return copiedFiles;
}

if (require.main === module) {
    try {
        const files = buildPages();
        console.log(`Prepared ${files.length} public Pages assets in dist.`);
    } catch (error) {
        console.error("Pages static asset build failed:", error.message);
        process.exitCode = 1;
    }
}

module.exports = { buildPages, isPrivateAssetPath, isPublicAssetPath };
