import cors from "@fastify/cors";
import "dotenv/config";
import Fastify, { FastifyInstance } from "fastify";
import multer from "fastify-multer";
import fs from "fs";

import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);
import { track } from "./lib/hog";
import { getEmails } from "./lib/imap";
import { checkToken } from "./lib/jwt";
import { prisma } from "./prisma";
import { registerRoutes } from "./routes";

// Ensure the directory exists
const logFilePath = "./logs.log"; // Update this path to a writable location

// Create a writable stream
const logStream = fs.createWriteStream(logFilePath, { flags: "a" });

// Initialize Fastify with logger
const server: FastifyInstance = Fastify({
  logger: {
    stream: logStream, // Use the writable stream
  },
  disableRequestLogging: true,
  trustProxy: true,
});
server.register(cors, {
  origin: "*",

  methods: ["GET", "POST", "PUT", "DELETE"],
  allowedHeaders: ["Content-Type", "Authorization", "Accept"],
});

server.register(multer.contentParser);

registerRoutes(server);

server.get(
  "/",
  {
    schema: {
      tags: ["health"], // This groups the endpoint under a category
      description: "Health check endpoint",
      response: {
        200: {
          type: "object",
          properties: {
            healthy: { type: "boolean" },
          },
        },
      },
    },
  },
  async function (request, response) {
    response.send({ healthy: true });
  }
);

// JWT authentication hook
server.addHook("preHandler", async function (request: any, reply: any) {
  try {
    if (request.url === "/api/v1/auth/login" && request.method === "POST") {
      return true;
    }
    if (
      request.url === "/api/v1/ticket/public/create" &&
      request.method === "POST"
    ) {
      return true;
    }
    // External SSO entry point - it carries a third-party bearer token,
    // not a Peppermint JWT, so it must bypass the standard JWT check.
    if (
      request.url.startsWith("/api/v1/external/login") &&
      request.method === "GET"
    ) {
      return true;
    }
    const bearer = request.headers.authorization!.split(" ")[1];
    checkToken(bearer);
  } catch (err) {
    reply.status(401).send({
      message: "Unauthorized",
      success: false,
    });
  }
});

const start = async () => {
  try {
    // Run prisma migrate / generate / seed sequentially. Each child process
    // must fully exit (releasing any file handles on the engine binary)
    // before the next one starts - otherwise on Windows the still-running
    // generate step can collide with seed/migrate and produce an EPERM on
    // query-engine-windows.exe. SKIP_PRISMA_BOOTSTRAP=1 disables the whole
    // sequence for dev when the client is already up to date.
    if (process.env.SKIP_PRISMA_BOOTSTRAP !== "1") {
      const steps: Array<{ cmd: string; ignoreErr?: boolean }> = [
        { cmd: "npx prisma migrate deploy" },
        { cmd: "npx prisma generate" },
        { cmd: "npx prisma db seed", ignoreErr: true },
      ];
      for (const step of steps) {
        try {
          const { stdout, stderr } = await execAsync(step.cmd);
          if (stdout) console.log(stdout);
          if (stderr) console.error(stderr);
        } catch (err: any) {
          if (step.ignoreErr) {
            console.error(`[bootstrap] ${step.cmd} failed (non-fatal):`, err?.message);
          } else {
            throw err;
          }
        }
      }
    }

    // connect to database
    await prisma.$connect();
    server.log.info("Connected to Prisma");

    const port = 5003;

    server.listen(
      { port: Number(port), host: "0.0.0.0" },
      async (err, address) => {
        if (err) {
          console.error(err);
          process.exit(1);
        }

        const client = track();

        client.capture({
          event: "server_started",
          distinctId: "uuid",
        });

        client.shutdownAsync();
        console.info(`Server listening on ${address}`);
      }
    );

    setInterval(() => getEmails(), 10000); // Call getEmails every minute
  } catch (err) {
    server.log.error(err);
    await prisma.$disconnect();
    process.exit(1);
  }
};

start();
