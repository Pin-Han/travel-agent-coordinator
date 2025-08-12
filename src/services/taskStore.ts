import { TaskData, APICallStatus } from '../types/index.js';

export class TaskStoreService {
  private tasks: Map<string, TaskData> = new Map();
  private readonly TASK_CLEANUP_INTERVAL = 3600000; // 1 hour
  private readonly TASK_RETENTION_TIME = 86400000; // 24 hours

  constructor() {
    // 定期清理過期任務
    setInterval(() => {
      this.cleanupExpiredTasks();
    }, this.TASK_CLEANUP_INTERVAL);
  }

  /**
   * 創建新任務
   */
  createTask(
    taskId: string,
    message: any,
    userId?: string
  ): TaskData {
    const now = new Date().toISOString();
    
    const task: TaskData = {
      taskId,
      status: {
        state: 'working',
        message: '正在初始化任務...'
      },
      messages: [message],
      artifacts: [],
      createdAt: now,
      updatedAt: now,
      apiCallStatus: {
        pending: [],
        completed: [],
        failed: []
      }
    };

    this.tasks.set(taskId, task);
    console.log(`📋 創建任務: ${taskId}`);
    
    return task;
  }

  /**
   * 獲取任務
   */
  getTask(taskId: string): TaskData | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * 更新任務狀態
   */
  updateTaskStatus(
    taskId: string,
    status: TaskData['status']
  ): boolean {
    const task = this.tasks.get(taskId);
    if (!task) {
      console.warn(`⚠️ 嘗試更新不存在的任務: ${taskId}`);
      return false;
    }

    task.status = status;
    task.updatedAt = new Date().toISOString();
    
    console.log(`📝 更新任務狀態 ${taskId}: ${status.state}`);
    return true;
  }

  /**
   * 添加 API 呼叫到待處理列表
   */
  addPendingAPICall(taskId: string, apiName: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (!task.apiCallStatus.pending.includes(apiName)) {
      task.apiCallStatus.pending.push(apiName);
      task.updatedAt = new Date().toISOString();
      console.log(`⏳ 添加待處理 API: ${apiName} for task ${taskId}`);
    }
    
    return true;
  }

  /**
   * 標記 API 呼叫完成
   */
  markAPICallCompleted(
    taskId: string,
    apiName: string,
    action: string,
    result: any
  ): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // 從待處理列表移除
    task.apiCallStatus.pending = task.apiCallStatus.pending.filter(
      name => name !== apiName
    );

    // 添加到完成列表
    task.apiCallStatus.completed.push({
      api: apiName,
      action,
      result,
      timestamp: new Date().toISOString()
    });

    task.updatedAt = new Date().toISOString();
    console.log(`✅ API 呼叫完成: ${apiName} for task ${taskId}`);
    
    return true;
  }

  /**
   * 標記 API 呼叫失敗
   */
  markAPICallFailed(
    taskId: string,
    apiName: string,
    action: string,
    error: string
  ): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    // 從待處理列表移除
    task.apiCallStatus.pending = task.apiCallStatus.pending.filter(
      name => name !== apiName
    );

    // 添加到失敗列表
    task.apiCallStatus.failed.push({
      api: apiName,
      action,
      error,
      timestamp: new Date().toISOString()
    });

    task.updatedAt = new Date().toISOString();
    console.log(`❌ API 呼叫失敗: ${apiName} for task ${taskId} - ${error}`);
    
    return true;
  }

  /**
   * 添加任務結果文件
   */
  addTaskArtifact(
    taskId: string,
    artifact: any
  ): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    task.artifacts.push(artifact);
    task.updatedAt = new Date().toISOString();
    
    console.log(`📎 添加任務結果: ${artifact.name || artifact.artifactId} for task ${taskId}`);
    return true;
  }

  /**
   * 檢查任務是否完成
   */
  isTaskCompleted(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    return task.status.state === 'completed' || task.status.state === 'failed';
  }

  /**
   * 檢查是否所有 API 呼叫都已完成
   */
  areAllAPICallsFinished(taskId: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    return task.apiCallStatus.pending.length === 0;
  }

  /**
   * 獲取任務進度摘要
   */
  getTaskProgress(taskId: string): any {
    const task = this.tasks.get(taskId);
    if (!task) return null;

    const { apiCallStatus } = task;
    const totalCalls = apiCallStatus.completed.length + apiCallStatus.failed.length + apiCallStatus.pending.length;
    const finishedCalls = apiCallStatus.completed.length + apiCallStatus.failed.length;

    return {
      taskId,
      status: task.status,
      progress: {
        total_api_calls: totalCalls,
        completed_calls: apiCallStatus.completed.length,
        failed_calls: apiCallStatus.failed.length,
        pending_calls: apiCallStatus.pending.length,
        completion_percentage: totalCalls > 0 ? Math.round((finishedCalls / totalCalls) * 100) : 0
      },
      created_at: task.createdAt,
      updated_at: task.updatedAt
    };
  }

  /**
   * 獲取所有活躍任務
   */
  getActiveTasks(): TaskData[] {
    return Array.from(this.tasks.values()).filter(
      task => task.status.state === 'working'
    );
  }

  /**
   * 取消任務
   */
  cancelTask(taskId: string, reason?: string): boolean {
    const task = this.tasks.get(taskId);
    if (!task) return false;

    if (task.status.state === 'working') {
      task.status = {
        state: 'cancelled',
        message: reason || '任務已被取消'
      };
      task.updatedAt = new Date().toISOString();
      
      console.log(`🚫 取消任務: ${taskId} - ${reason || '用戶請求'}`);
      return true;
    }

    return false;
  }

  /**
   * 刪除任務
   */
  deleteTask(taskId: string): boolean {
    const existed = this.tasks.delete(taskId);
    if (existed) {
      console.log(`🗑️ 刪除任務: ${taskId}`);
    }
    return existed;
  }

  /**
   * 清理過期任務
   */
  private cleanupExpiredTasks(): void {
    const now = Date.now();
    const expiredTasks: string[] = [];

    for (const [taskId, task] of this.tasks.entries()) {
      const taskAge = now - new Date(task.createdAt).getTime();
      
      // 清理超過保留時間的已完成任務
      if (this.isTaskCompleted(taskId) && taskAge > this.TASK_RETENTION_TIME) {
        expiredTasks.push(taskId);
      }
      
      // 清理超過兩倍保留時間的所有任務（防止記憶體洩漏）
      if (taskAge > this.TASK_RETENTION_TIME * 2) {
        expiredTasks.push(taskId);
      }
    }

    expiredTasks.forEach(taskId => {
      this.deleteTask(taskId);
    });

    if (expiredTasks.length > 0) {
      console.log(`🧹 清理了 ${expiredTasks.length} 個過期任務`);
    }
  }

  /**
   * 獲取存儲統計資訊
   */
  getStats(): any {
    const allTasks = Array.from(this.tasks.values());
    
    return {
      total_tasks: allTasks.length,
      working_tasks: allTasks.filter(t => t.status.state === 'working').length,
      completed_tasks: allTasks.filter(t => t.status.state === 'completed').length,
      failed_tasks: allTasks.filter(t => t.status.state === 'failed').length,
      cancelled_tasks: allTasks.filter(t => t.status.state === 'cancelled').length,
      oldest_task: allTasks.length > 0 ? 
        Math.min(...allTasks.map(t => new Date(t.createdAt).getTime())) : null,
      newest_task: allTasks.length > 0 ? 
        Math.max(...allTasks.map(t => new Date(t.createdAt).getTime())) : null
    };
  }
}
