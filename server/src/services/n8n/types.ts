export interface N8nConfig {
    baseUrl: string;
    apiKey: string;
  }
  
  export type N8nExecutionStatus = 
    | 'new' | 'running' | 'success' | 'error' | 'canceled' | 'waiting';
  
  export interface N8nExecution {
    id: string;
    finished: boolean;
    mode: string;
    startedAt: string;
    stoppedAt?: string;
    workflowId: string;
    status: N8nExecutionStatus;
    data?: {
      resultData: {
        runData: Record<string, any[]>;
        lastNodeExecuted?: string;
      };
    };
  }
  
  export interface N8nWorkflow {
    id: string;
    name: string;
    active: boolean;
    nodes: Array<{ id: string; name: string; type: string }>;
  }
  
  export interface ExecutionProgress {
    status: N8nExecutionStatus;
    currentNode: string | null;
    completedNodes: string[];
    pendingNodes: string[];
    progress: number;
    errors: Array<{ node: string; message: string }>;
  }
  