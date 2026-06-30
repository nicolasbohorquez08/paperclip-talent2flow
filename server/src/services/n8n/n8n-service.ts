import { N8nConfig, N8nExecution, N8nWorkflow, ExecutionProgress } from './types.js';

export class N8nService {
  private baseUrl: string;
  private headers: Record<string, string>;

  constructor(config: N8nConfig) {
    this.baseUrl = `${config.baseUrl}/api/v1`;
    this.headers = {
      'X-N8N-API-KEY': config.apiKey,
      'Content-Type': 'application/json',
    };
  }

  // Lista ejecuciones
  async getExecutions(params?: {
    workflowId?: string;
    status?: string;
    limit?: number;
  }): Promise<{ data: N8nExecution[] }> {
    const query = new URLSearchParams();
    if (params?.workflowId) query.set('workflowId', params.workflowId);
    if (params?.status) query.set('status', params.status);
    if (params?.limit) query.set('limit', String(params.limit));

    return this.fetch(`/executions?${query}`);
  }

  // Detalle de ejecución
  async getExecution(id: string): Promise<N8nExecution> {
    return this.fetch(`/executions/${id}`);
  }

  // Estado con nodo actual y progreso
  async getExecutionProgress(id: string): Promise<ExecutionProgress> {
    const execution = await this.getExecution(id);
    
    const runData = execution.data?.resultData?.runData || {};
    const completedNodes = Object.keys(runData);
    const currentNode = execution.data?.resultData?.lastNodeExecuted || null;

    // Obtener todos los nodos del workflow
    const workflow = await this.getWorkflow(execution.workflowId);
    const allNodes = workflow.nodes.map(n => n.name);
    const pendingNodes = allNodes.filter(n => !completedNodes.includes(n));

    // Extraer errores
    const errors: Array<{ node: string; message: string }> = [];
    for (const [nodeName, executions] of Object.entries(runData)) {
      for (const exec of executions as any[]) {
        if (exec.executionStatus === 'error') {
          errors.push({ node: nodeName, message: exec.error?.message || 'Error' });
        }
      }
    }

    const progress = allNodes.length > 0
      ? Math.round((completedNodes.length / allNodes.length) * 100)
      : 0;

    return {
      status: execution.status,
      currentNode,
      completedNodes,
      pendingNodes,
      progress,
      errors,
    };
  }

  // Detener ejecución
  async stopExecution(id: string): Promise<N8nExecution> {
    return this.fetch(`/executions/${id}/stop`, { method: 'POST' });
  }

  // Lista workflows
  async getWorkflows(active?: boolean): Promise<{ data: N8nWorkflow[] }> {
    const query = active !== undefined ? `?active=${active}` : '';
    return this.fetch(`/workflows${query}`);
  }

  // Detalle workflow
  async getWorkflow(id: string): Promise<N8nWorkflow> {
    return this.fetch(`/workflows/${id}`);
  }

  // Ejecutar workflow
  async executeWorkflow(id: string, data?: Record<string, unknown>): Promise<N8nExecution> {
    return this.fetch(`/workflows/${id}/run`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  }

  private async fetch<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${endpoint}`, {
      ...options,
      headers: this.headers,
    });

    if (!res.ok) {
      throw new Error(`n8n API error: ${res.status} ${res.statusText}`);
    }

    return res.json();
  }
}
