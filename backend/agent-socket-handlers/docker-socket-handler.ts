import { AgentSocketHandler } from "../agent-socket-handler";
import { DockgeServer } from "../dockge-server";
import { callbackError, callbackResult, checkLogin, DockgeSocket, ValidationError } from "../util-server";
import { DeleteOptions, Stack } from "../stack";
import { AgentSocket } from "../../common/agent-socket";
import { Settings } from "../settings";
import { LooseObject } from "../../common/util-common";
import childProcessAsync from "promisify-child-process";
import fs from "fs";
import path from "path";
import crypto from "crypto";

interface UploadRecord {
    path : string;
    fileSize : number;
    receivedBytes : number;
    nextChunkIndex : number;
    ownerSocketId : string;
    lastActivityAt : number;
}

// How long an upload can sit idle (no chunk received) before it is swept away
const UPLOAD_MAX_IDLE_MS = 30 * 60 * 1000;
const UPLOAD_SWEEP_INTERVAL_MS = 5 * 60 * 1000;

export class DockerSocketHandler extends AgentSocketHandler {
    private uploadRecords : Map<string, UploadRecord> = new Map();
    private uploadSweepStarted = false;

    create(socket : DockgeSocket, server : DockgeServer, agentSocket : AgentSocket) {
        // Do not call super.create()

        this.startUploadSweep();

        agentSocket.on("deployStack", async (name : unknown, composeYAML : unknown, composeENV : unknown, composeOverrideYAML : unknown, isAdd : unknown, callback) => {
            try {
                checkLogin(socket);
                const stack = await this.saveStack(server, name, composeYAML, composeENV, composeOverrideYAML, isAdd);
                await stack.deploy(socket);
                server.sendStackList();
                callbackResult({
                    ok: true,
                    msg: "Deployed",
                    msgi18n: true,
                }, callback);
                stack.joinCombinedTerminal(socket);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("saveStack", async (name : unknown, composeYAML : unknown, composeENV : unknown, composeOverrideYAML : unknown, isAdd : unknown, callback) => {
            try {
                checkLogin(socket);
                await this.saveStack(server, name, composeYAML, composeENV, composeOverrideYAML, isAdd);
                callbackResult({
                    ok: true,
                    msg: "Saved",
                    msgi18n: true,
                }, callback);
                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("deleteStack", async (name : unknown, deleteOptions: unknown, callback) => {
            try {
                checkLogin(socket);
                if (typeof(name) !== "string") {
                    throw new ValidationError("Name must be a string");
                }
                const stack = await Stack.getStack(server, name);

                try {
                    await stack.delete(socket, deleteOptions as DeleteOptions);
                } catch (e) {
                    server.sendStackList();
                    throw e;
                }

                server.sendStackList();
                callbackResult({
                    ok: true,
                    msg: "Deleted",
                    msgi18n: true,
                }, callback);

            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("forceDeleteStack", async (name : unknown, callback) => {
            try {
                checkLogin(socket);
                if (typeof(name) !== "string") {
                    throw new ValidationError("Name must be a string");
                }
                const stack = await Stack.getStack(server, name);
                await stack.forceDelete(socket);
                server.sendStackList();
                callbackResult({
                    ok: true,
                    msg: "Deleted",
                    msgi18n: true,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("getStack", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);

                if (stack.isManagedByDockge) {
                    stack.joinCombinedTerminal(socket);
                }

                callbackResult({
                    ok: true,
                    stack: await stack.toJSON(socket.endpoint),
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // requestStackList
        agentSocket.on("requestStackList", async (callback) => {
            try {
                checkLogin(socket);
                server.sendStackList();
                callbackResult({
                    ok: true,
                    msg: "Updated",
                    msgi18n: true,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // startStack
        agentSocket.on("startStack", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.start(socket);
                callbackResult({
                    ok: true,
                    msg: "Started",
                    msgi18n: true,
                }, callback);
                server.sendStackList();

                stack.joinCombinedTerminal(socket);

            } catch (e) {
                callbackError(e, callback);
            }
        });

        // stopStack
        agentSocket.on("stopStack", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.stop(socket);
                callbackResult({
                    ok: true,
                    msg: "Stopped",
                    msgi18n: true,
                }, callback);
                server.sendStackList();

                stack.leaveCombinedTerminal(socket);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // restartStack
        agentSocket.on("restartStack", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.restart(socket);
                callbackResult({
                    ok: true,
                    msg: "Restarted",
                    msgi18n: true,
                }, callback);
                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // updateStack
        agentSocket.on("updateStack", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.update(socket);
                callbackResult({
                    ok: true,
                    msg: `Updated ${stackName}`,
                    msgi18n: true,
                }, callback);
                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // down stack
        agentSocket.on("downStack", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.down(socket);
                callbackResult({
                    ok: true,
                    msg: "Downed",
                    msgi18n: true,
                }, callback);
                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Services status
        agentSocket.on("serviceStatusList", async (stackName : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }

                const stack = await Stack.getStack(server, stackName, true);
                const serviceStatusList = Object.fromEntries(await stack.getServiceStatusList());
                callbackResult({
                    ok: true,
                    serviceStatusList,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Docker stats
        agentSocket.on("dockerStats", async (callback) => {
            try {
                checkLogin(socket);

                const dockerStats = Object.fromEntries(await server.getDockerStats());
                callbackResult({
                    ok: true,
                    dockerStats,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Start a service
        agentSocket.on("startService", async (stackName: unknown, serviceName: unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof (stackName) !== "string" || typeof (serviceName) !== "string") {
                    throw new ValidationError("Stack name and service name must be strings");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.startService(socket, serviceName);
                stack.joinCombinedTerminal(socket); // Ensure the combined terminal is joined
                callbackResult({
                    ok: true,
                    msg: "Service " + serviceName + " started"
                }, callback);
                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // Stop a service
        agentSocket.on("stopService", async (stackName: unknown, serviceName: unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof (stackName) !== "string" || typeof (serviceName) !== "string") {
                    throw new ValidationError("Stack name and service name must be strings");
                }

                const stack = await Stack.getStack(server, stackName);
                await stack.stopService(socket, serviceName);
                callbackResult({
                    ok: true,
                    msg: "Service " + serviceName + " stopped"
                }, callback);
                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        agentSocket.on("restartService", async (stackName: unknown, serviceName: unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof stackName !== "string" || typeof serviceName !== "string") {
                    throw new Error("Invalid stackName or serviceName");
                }

                const stack = await Stack.getStack(server, stackName, true);
                await stack.restartService(socket, serviceName);
                callbackResult({
                    ok: true,
                    msg: "Service " + serviceName + " restarted"
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // getExternalNetworkList
        agentSocket.on("getDockerNetworkList", async (callback) => {
            try {
                checkLogin(socket);
                const dockerNetworkList = await server.getDockerNetworkList();
                callbackResult({
                    ok: true,
                    dockerNetworkList,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // setStackGroup - purely visual/organizational, no filesystem changes
        agentSocket.on("setStackGroup", async (stackName : unknown, group : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(stackName) !== "string") {
                    throw new ValidationError("Stack name must be a string");
                }
                if (group !== null && typeof(group) !== "string") {
                    throw new ValidationError("Group must be a string or null");
                }

                // Throws if the stack doesn't exist
                await Stack.getStack(server, stackName);

                const map : LooseObject = (await Settings.get("stackGroups")) || {};
                const trimmed = typeof(group) === "string" ? group.trim() : "";

                if (trimmed === "") {
                    delete map[stackName];
                } else {
                    const segments = trimmed.split("/").map((s : string) => s.trim());
                    if (segments.some((s : string) => s === "")) {
                        throw new ValidationError("Folder path segments can't be empty");
                    }
                    if (segments.length > 2) {
                        throw new ValidationError("Only one level of subfolder is supported");
                    }
                    map[stackName] = segments.join("/");
                }

                await Settings.set("stackGroups", map);

                callbackResult({
                    ok: true,
                    msg: trimmed ? "Moved" : "Removed from group",
                    msgi18n: true,
                }, callback);
                server.sendStackList();
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // getDockerImageList
        agentSocket.on("getDockerImageList", async (callback) => {
            try {
                checkLogin(socket);
                const imageList = await this.getDockerImageList();
                callbackResult({
                    ok: true,
                    imageList,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // deleteDockerImage
        agentSocket.on("deleteDockerImage", async (imageId : unknown, callback) => {
            try {
                checkLogin(socket);
                if (typeof(imageId) !== "string") {
                    throw new ValidationError("Image ID must be a string");
                }
                await this.deleteDockerImage(imageId);
                callbackResult({
                    ok: true,
                    msg: "Image Deleted",
                    msgi18n: true,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // getDockerDiskUsage
        agentSocket.on("getDockerDiskUsage", async (callback) => {
            try {
                checkLogin(socket);
                const diskUsage = await this.getDockerDiskUsage();
                callbackResult({
                    ok: true,
                    diskUsage,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // pullDockerImage
        agentSocket.on("pullDockerImage", async (imageName : unknown, callback) => {
            try {
                checkLogin(socket);
                if (typeof(imageName) !== "string") {
                    throw new ValidationError("Image name must be a string");
                }
                await this.pullDockerImage(imageName);
                callbackResult({
                    ok: true,
                    msg: "Image Pulled",
                    msgi18n: true,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // buildDockerImage
        agentSocket.on("buildDockerImage", async (imageName : unknown, dockerfileContent : unknown, callback) => {
            try {
                checkLogin(socket);
                if (typeof(imageName) !== "string") {
                    throw new ValidationError("Image name must be a string");
                }
                if (typeof(dockerfileContent) !== "string") {
                    throw new ValidationError("Dockerfile content must be a string");
                }
                await this.buildDockerImage(imageName, dockerfileContent);
                callbackResult({
                    ok: true,
                    msg: "Image Built",
                    msgi18n: true,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // pruneDockerImages
        agentSocket.on("pruneDockerImages", async (callback) => {
            try {
                checkLogin(socket);
                const result = await this.pruneDockerImages();
                callbackResult({
                    ok: true,
                    msg: "Images Pruned",
                    msgi18n: true,
                    result,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // startImageUpload
        agentSocket.on("startImageUpload", async (fileName : unknown, fileSize : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(fileName) !== "string" || fileName.trim() === "") {
                    throw new ValidationError("File name must be a non-empty string");
                }
                if (typeof(fileSize) !== "number" || !Number.isFinite(fileSize) || fileSize <= 0) {
                    throw new ValidationError("File size must be a positive number");
                }
                if (fileSize > server.maxImageUploadSize) {
                    throw new ValidationError("File is too large. Max allowed size is " + server.maxImageUploadSize + " bytes.");
                }

                // Never trust the client-supplied name/id for filesystem paths
                const uploadId = crypto.randomUUID();
                const tarPath = path.join(server.uploadsDir, uploadId + ".tar");
                this.assertPathInsideUploadsDir(server, tarPath);

                this.uploadRecords.set(uploadId, {
                    path: tarPath,
                    fileSize,
                    receivedBytes: 0,
                    nextChunkIndex: 0,
                    ownerSocketId: socket.id,
                    lastActivityAt: Date.now(),
                });

                callbackResult({
                    ok: true,
                    uploadId,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // uploadImageChunk
        agentSocket.on("uploadImageChunk", async (uploadId : unknown, chunkIndex : unknown, chunk : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(uploadId) !== "string") {
                    throw new ValidationError("Upload ID must be a string");
                }
                if (typeof(chunkIndex) !== "number" || !Number.isInteger(chunkIndex) || chunkIndex < 0) {
                    throw new ValidationError("Chunk index must be a non-negative integer");
                }
                if (!Buffer.isBuffer(chunk) && !(chunk instanceof Uint8Array) && !(chunk instanceof ArrayBuffer)) {
                    throw new ValidationError("Chunk must be binary data");
                }

                const record = this.getOwnedUploadRecord(uploadId, socket.id);

                if (chunkIndex !== record.nextChunkIndex) {
                    throw new ValidationError("Unexpected chunk index");
                }

                const buf = Buffer.from(chunk as ArrayBuffer);

                // The first chunk always carries the file header, so this is the
                // cheapest point to reject something that was never a tar to begin
                // with (e.g. an executable renamed to end in .tar) before writing
                // anything to disk.
                if (chunkIndex === 0 && !this.looksLikeDockerLoadArchive(buf)) {
                    this.uploadRecords.delete(uploadId);
                    await fs.promises.unlink(record.path).catch(() => {});
                    throw new ValidationError("This file does not look like a valid Docker image archive (unsupported or corrupt tar file)");
                }

                if (record.receivedBytes + buf.length > record.fileSize) {
                    this.uploadRecords.delete(uploadId);
                    await fs.promises.unlink(record.path).catch(() => {});
                    throw new ValidationError("Upload exceeds the declared file size");
                }

                this.assertPathInsideUploadsDir(server, record.path);
                await fs.promises.appendFile(record.path, buf);

                record.receivedBytes += buf.length;
                record.nextChunkIndex += 1;
                record.lastActivityAt = Date.now();

                callbackResult({
                    ok: true,
                    receivedBytes: record.receivedBytes,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // finishImageUpload
        agentSocket.on("finishImageUpload", async (uploadId : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(uploadId) !== "string") {
                    throw new ValidationError("Upload ID must be a string");
                }

                const record = this.getOwnedUploadRecord(uploadId, socket.id);

                if (record.receivedBytes !== record.fileSize) {
                    throw new ValidationError("Upload is incomplete");
                }

                // Remove immediately so a duplicate/racing finish call can't load twice
                this.uploadRecords.delete(uploadId);

                try {
                    await this.loadDockerImage(record.path);
                } finally {
                    await fs.promises.unlink(record.path).catch(() => {});
                }

                callbackResult({
                    ok: true,
                    msg: "Image Loaded",
                    msgi18n: true,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });

        // cancelImageUpload
        agentSocket.on("cancelImageUpload", async (uploadId : unknown, callback) => {
            try {
                checkLogin(socket);

                if (typeof(uploadId) !== "string") {
                    throw new ValidationError("Upload ID must be a string");
                }

                const record = this.uploadRecords.get(uploadId);
                if (record && record.ownerSocketId === socket.id) {
                    this.uploadRecords.delete(uploadId);
                    await fs.promises.unlink(record.path).catch(() => {});
                }

                callbackResult({
                    ok: true,
                }, callback);
            } catch (e) {
                callbackError(e, callback);
            }
        });
    }

    /**
     * Look up an upload record, scoped to the socket that started it.
     * Returns the same generic error whether the id is unknown or owned by
     * someone else, so it can't be used to enumerate other sessions' uploads.
     */
    getOwnedUploadRecord(uploadId : string, socketId : string) : UploadRecord {
        const record = this.uploadRecords.get(uploadId);
        if (!record || record.ownerSocketId !== socketId) {
            throw new ValidationError("Upload not found");
        }
        return record;
    }

    /**
     * Sniff the first chunk of an upload for the magic bytes `docker load` can
     * actually consume (plain tar, or gzip/bzip2/xz-compressed tar). This is a
     * structural check only — it does not (and cannot) verify the archive contains
     * a well-formed image, only that it isn't obviously something else entirely
     * (e.g. an executable or script renamed to end in .tar).
     */
    looksLikeDockerLoadArchive(buf : Buffer) : boolean {
        if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
            return true; // gzip
        }
        if (buf.length >= 3 && buf[0] === 0x42 && buf[1] === 0x5a && buf[2] === 0x68) {
            return true; // bzip2 ("BZh")
        }
        if (buf.length >= 6 && buf[0] === 0xfd && buf[1] === 0x37 && buf[2] === 0x7a &&
            buf[3] === 0x58 && buf[4] === 0x5a && buf[5] === 0x00) {
            return true; // xz
        }
        if (buf.length >= 262 && buf.subarray(257, 262).toString("latin1") === "ustar") {
            return true; // POSIX/GNU tar
        }
        return false;
    }

    /**
     * Defense-in-depth: even though upload filenames are always server-generated
     * UUIDs, assert the resolved path can't ever land outside the uploads dir.
     */
    assertPathInsideUploadsDir(server : DockgeServer, filePath : string) {
        const resolvedDir = path.resolve(server.uploadsDir);
        const resolvedFile = path.resolve(filePath);
        if (path.dirname(resolvedFile) !== resolvedDir) {
            throw new Error("Resolved upload path escapes the uploads directory");
        }
    }

    /**
     * Periodically evict abandoned uploads (e.g. a tab closed mid-upload) so their
     * partial tar files and in-memory records don't accumulate for the life of the
     * server process.
     */
    startUploadSweep() {
        if (this.uploadSweepStarted) {
            return;
        }
        this.uploadSweepStarted = true;

        setInterval(() => {
            const now = Date.now();
            for (const [ uploadId, record ] of this.uploadRecords) {
                if (now - record.lastActivityAt > UPLOAD_MAX_IDLE_MS) {
                    this.uploadRecords.delete(uploadId);
                    fs.promises.unlink(record.path).catch(() => {});
                }
            }
        }, UPLOAD_SWEEP_INTERVAL_MS);
    }

    async saveStack(server : DockgeServer, name : unknown, composeYAML : unknown, composeENV : unknown, composeOverrideYAML : unknown, isAdd : unknown) : Promise<Stack> {
        // Check types
        if (typeof(name) !== "string") {
            throw new ValidationError("Name must be a string");
        }
        if (typeof(composeYAML) !== "string") {
            throw new ValidationError("Compose YAML must be a string");
        }
        if (typeof(composeENV) !== "string") {
            throw new ValidationError("Compose ENV must be a string");
        }
        if (typeof(composeOverrideYAML) !== "string") {
            throw new ValidationError("Compose Override YAML must be a string");
        }
        if (typeof(isAdd) !== "boolean") {
            throw new ValidationError("isAdd must be a boolean");
        }

        const stack = new Stack(server, name, composeYAML, composeENV, composeOverrideYAML, false);
        await stack.save(isAdd);
        return stack;
    }

    /**
     * Get the list of Docker images
     * @returns List of Docker images with their details
     */
    async getDockerImageList() {
        const res = await childProcessAsync.spawn("docker", [ "images", "--format", "json" ], {
            encoding: "utf-8",
        });

        if (!res.stdout) {
            return [];
        }

        const output = res.stdout.toString().trim();
        if (!output) {
            return [];
        }

        const lines = output.split("\n");
        const imageList = lines.map((line : string) => {
            try {
                return JSON.parse(line);
            } catch (e) {
                return null;
            }
        }).filter((img : unknown) => img !== null);

        return imageList;
    }

    /**
     * Delete a Docker image by ID or name
     * @param imageId - The image ID or name to delete
     * @throws Error with Docker error message if deletion fails
     */
    async deleteDockerImage(imageId : string) {
        try {
            await childProcessAsync.spawn("docker", [ "rmi", imageId ], {
                encoding: "utf-8",
            });
        } catch (error : any) {
            // Extract meaningful error message from Docker
            const stderr = error.stderr?.toString() || "";
            const stdout = error.stdout?.toString() || "";
            const errorMessage = stderr || stdout || error.message || "Failed to delete image";

            // Throw error with the actual Docker message
            throw new Error(errorMessage);
        }
    }

    /**
     * Get Docker disk usage information
     * @returns Docker disk usage statistics
     */
    async getDockerDiskUsage() {
        const res = await childProcessAsync.spawn("docker", [ "system", "df", "--format", "json" ], {
            encoding: "utf-8",
        });

        if (!res.stdout) {
            return {};
        }

        const output = res.stdout.toString().trim();
        if (!output) {
            return {};
        }

        return JSON.parse(output);
    }

    /**
     * Pull a Docker image from registry
     * @param imageName - The image name to pull (e.g., "nginx:latest")
     * @throws Error with Docker error message if pull fails
     */
    async pullDockerImage(imageName : string) {
        try {
            await childProcessAsync.spawn("docker", [ "pull", imageName ], {
                encoding: "utf-8",
            });
        } catch (error : any) {
            const stderr = error.stderr?.toString() || "";
            const stdout = error.stdout?.toString() || "";
            const errorMessage = stderr || stdout || error.message || "Failed to pull image";
            throw new Error(errorMessage);
        }
    }

    /**
     * Build a Docker image from Dockerfile content
     * @param imageName - The name/tag for the built image (e.g., "myapp:latest")
     * @param dockerfileContent - The content of the Dockerfile
     * @throws Error with Docker error message if build fails
     */
    async buildDockerImage(imageName : string, dockerfileContent : string) {
        const fs = await import("fs");
        const os = await import("os");
        const path = await import("path");

        // Create a temporary directory for the build context
        const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "dockge-build-"));
        const dockerfilePath = path.join(tempDir, "Dockerfile");

        try {
            // Write Dockerfile content to temp directory
            fs.writeFileSync(dockerfilePath, dockerfileContent);

            // Build the image
            try {
                await childProcessAsync.spawn("docker", [ "build", "-t", imageName, tempDir ], {
                    encoding: "utf-8",
                });
            } catch (error : any) {
                const stderr = error.stderr?.toString() || "";
                const stdout = error.stdout?.toString() || "";
                const errorMessage = stderr || stdout || error.message || "Failed to build image";
                throw new Error(errorMessage);
            }
        } finally {
            // Clean up temp directory
            try {
                fs.rmSync(tempDir, { recursive: true, force: true });
            } catch (e) {
                // Ignore cleanup errors
                }
        }
    }

    /**
     * Load a Docker image from a tar file produced by `docker save`
     * @param tarPath - Absolute path to the tar file
     * @throws Error with Docker error message if load fails
     */
    async loadDockerImage(tarPath : string) {
        try {
            await childProcessAsync.spawn("docker", [ "load", "-i", tarPath ], {
                encoding: "utf-8",
            });
        } catch (error : any) {
            const stderr = error.stderr?.toString() || "";
            const stdout = error.stdout?.toString() || "";
            const errorMessage = stderr || stdout || error.message || "Failed to load image";
            throw new Error(errorMessage);
        }
    }

    /**
     * Prune unused Docker images
     * @returns Result of the prune operation
     */
    async pruneDockerImages() {
        const res = await childProcessAsync.spawn("docker", [ "image", "prune", "-a", "-f" ], {
            encoding: "utf-8",
        });

        return {
            stdout: res.stdout?.toString() || "",
            stderr: res.stderr?.toString() || "",
        };
    }

}
