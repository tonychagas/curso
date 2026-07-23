import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

const server = new Server(
  {
    name: "dotnet-build-mcp",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "dotnet_build",
        description: "Compila um projeto .NET e retorna erros",
        inputSchema: {
          type: "object",
          properties: {
            projectPath: {
              type: "string",
              description: "Caminho do projeto ou solução .NET",
            },
            configuration: {
              type: "string",
              description: "Configuração (Debug/Release)",
              enum: ["Debug", "Release"],
            },
          },
          required: ["projectPath"],
        },
      },
    ],
  };
});

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === "dotnet_build") {
    const projectPath = args?.projectPath;
    const configuration = args?.configuration || "Debug";

    try {
      const command = `dotnet build "${projectPath}" -c ${configuration} --no-restore`;
      const { stdout, stderr } = await execAsync(command);
      
      const output = stdout || stderr || "Build concluído sem saída.";
      
      return {
        content: [
          {
            type: "text",
            text: output,
          },
        ],
      };
    } catch (error) {
      return {
        content: [
          {
            type: "text",
            text: `❌ Erro no build:\n${error.message}`,
          },
        ],
      };
    }
  }

  throw new Error(`Ferramenta ${name} não encontrada`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("Dotnet Build MCP rodando...");
}

main().catch((error) => {
  console.error("Erro:", error);
  process.exit(1);
});