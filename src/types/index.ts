// A2A 和協調代理相關類型定義

export interface AgentRegistry {
  id: string;
  name: string;
  endpoint: string;
  apiKey?: string;
  description: string;
  capabilities: string[];
  healthCheckEndpoint?: string; // 健康檢查端點
  maxRetries?: number; // 最大重試次數
  timeout?: number; // 超時設定
}

export interface APICallStatus {
  pending: string[];
  completed: Array<{
    api: string;
    action?: string;
    result: any;
    timestamp: string;
  }>;
  failed: Array<{
    api: string;
    action?: string;
    error: string;
    timestamp: string;
  }>;
}

export interface TaskData {
  taskId: string;
  status: {
    state: "working" | "completed" | "failed" | "cancelled";
    message?: any;
    error?: string;
  };
  messages: any[];
  artifacts: any[];
  createdAt: string;
  updatedAt?: string;
  apiCallStatus: APICallStatus;
}

export interface OrchestratorConfig {
  port: number;
  agentId: string;
  agentName: string;
  agentDescription: string;
  maxCoordinationSteps: number;
  taskTimeoutMs: number;
}

export interface TravelRequest {
  destination: string;
  budget?: number;
  duration?: number;
  preferences?: string[];
  startDate?: string;
  endDate?: string;
  travelers?: number;
}

export interface AgentAPIResponse {
  success: boolean;
  data?: any;
  error?: string;
  api: string;
  action?: string;
  timestamp?: string;
}
