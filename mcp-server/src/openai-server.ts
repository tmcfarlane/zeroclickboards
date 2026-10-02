import { McpServer, type RegisteredTool, type ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ListToolsRequestSchema, type ToolAnnotations, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { normalizeObjectSchema, type AnySchema, type ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { toJsonSchemaCompat } from '@modelcontextprotocol/sdk/server/zod-json-schema-compat.js';

/** SDK 1.29 only emits _meta. Publish OpenAI's top-level securitySchemes as well. */
export class OpenAiMcpServer extends McpServer {
  private readonly tools = new Map<string, RegisteredTool>();
  override registerTool<OutputArgs extends ZodRawShapeCompat | AnySchema,
    InputArgs extends undefined | ZodRawShapeCompat | AnySchema = undefined>(name: string, config: {
      title?: string; description?: string; inputSchema?: InputArgs; outputSchema?: OutputArgs;
      annotations?: ToolAnnotations; _meta?: Record<string, unknown>;
    }, callback: ToolCallback<InputArgs>): RegisteredTool {
    const registered = super.registerTool(name, config, callback);
    this.tools.set(name, registered);
    this.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [...this.tools].filter(([, tool]) => tool.enabled).map(([toolName, tool]) => {
        const input = normalizeObjectSchema(tool.inputSchema);
        const output = normalizeObjectSchema(tool.outputSchema);
        return {
          name: toolName, title: tool.title, description: tool.description,
          inputSchema: { ...(input ? toJsonSchemaCompat(input, { strictUnions: true, pipeStrategy: 'input' }) : { properties: {} }), type: 'object' as const },
          ...(output ? { outputSchema: { ...toJsonSchemaCompat(output, { strictUnions: true, pipeStrategy: 'output' }), type: 'object' as const } } : {}),
          annotations: tool.annotations, execution: tool.execution, _meta: tool._meta,
          securitySchemes: tool._meta?.securitySchemes,
        } as Tool;
      }),
    }));
    return registered;
  }
}
