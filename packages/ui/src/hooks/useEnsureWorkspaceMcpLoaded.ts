import { useCallback, useEffect, useState } from "react";
import type { CodexMcpSyncCandidate, CodexSkillSyncCandidate } from "@zcode/shared";
import { useOptionalServices, useServices } from "@/hooks/useServices.js";
import { useMcpStore } from "@/store/mcpStore.js";

export function useEnsureWorkspaceMcpLoaded(
  workspaceAbsPath: string,
  workspaceIdentity: string | undefined,
  rpcReady: boolean,
) {
  const services = useServices();

  // 修复说明：这里曾把当前 tab 的 mcpSyncService 设为 store 的全局目录服务，设置页 Scope
  // 选中其他设备时写入仍落到当前 tab 所在设备。现在目录服务随目标一起经
  // ensureLoadedForWorkspace 绑定，不再有全局服务。
  useEffect(() => {
    if (!rpcReady) {
      // remote tab 恢复时 App 会先拿到断连代理；若立即
      // 读取 MCP 目录，只是在 store 内吞掉了断连错误，并未遵守 workspace
      // RPC 隔离边界。等待真实 services 注册后再执行，不缓存也不跨 transport 重放。
      return;
    }
    void useMcpStore
      .getState()
      .ensureLoadedForWorkspace(workspaceAbsPath, services.mcpSyncService, workspaceIdentity);
  }, [rpcReady, services.mcpSyncService, workspaceAbsPath, workspaceIdentity]);
}

/** Read compatibility metadata from the executing Host without connecting MCP servers. */
export function useCodexMcpSyncCandidates(
  enabled: boolean,
  workspacePath?: string,
  workspaceIdentity?: string,
) {
  const services = useOptionalServices();
  const service = services?.mcpSyncService;
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([workspacePath, workspaceIdentity]);
  const [state, setState] = useState<{
    key: string;
    owner: typeof service;
    status: "loading" | "ready" | "error";
    candidates: CodexMcpSyncCandidate[];
  }>({ key: "", owner: undefined, status: "loading", candidates: [] });
  useEffect(() => {
    if (!enabled || !workspacePath || !service) return;
    let cancelled = false;
    setState({ key, owner: service, status: "loading", candidates: [] });
    // 切换工作区或 Host 后丢弃旧请求，不能把上一个设备的列表用于当前选择。
    void Promise.resolve()
      .then(() => service.listCodexMcpSyncCandidates({ workspacePath, workspaceIdentity }))
      .then(
        (candidates) => {
          if (!cancelled) setState({ key, owner: service, status: "ready", candidates });
        },
        () => {
          if (!cancelled) setState({ key, owner: service, status: "error", candidates: [] });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [enabled, workspacePath, workspaceIdentity, service, key, revision]);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const status = !enabled
    ? "idle"
    : !workspacePath || !service
      ? "unavailable"
      : state.key !== key || state.owner !== service
        ? "loading"
        : state.status;
  return { status, candidates: status === "ready" ? state.candidates : [], reload };
}

/** Read only skill metadata from the same Host that supplies native-turn resources. */
export function useCodexSkillSyncCandidates(
  enabled: boolean,
  workspacePath?: string,
  workspaceIdentity?: string,
) {
  const services = useOptionalServices();
  const service = services?.skillsService;
  const [revision, setRevision] = useState(0);
  const key = JSON.stringify([workspacePath, workspaceIdentity]);
  const [state, setState] = useState<{
    key: string;
    owner: typeof service;
    status: "loading" | "ready" | "error";
    candidates: CodexSkillSyncCandidate[];
  }>({ key: "", owner: undefined, status: "loading", candidates: [] });
  useEffect(() => {
    if (!enabled || !workspacePath || !service) return;
    let cancelled = false;
    setState({ key, owner: service, status: "loading", candidates: [] });
    // 工作区或 Host 变更时，旧设备技能列表不能回填当前同步选择。
    void Promise.resolve()
      .then(() => service.listCodexSyncCandidates({ workspacePath, workspaceIdentity }))
      .then(
        (candidates) => {
          if (!cancelled) setState({ key, owner: service, status: "ready", candidates });
        },
        () => {
          if (!cancelled) setState({ key, owner: service, status: "error", candidates: [] });
        },
      );
    return () => {
      cancelled = true;
    };
  }, [enabled, workspacePath, workspaceIdentity, service, key, revision]);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  const status = !enabled
    ? "idle"
    : !workspacePath || !service
      ? "unavailable"
      : state.key !== key || state.owner !== service
        ? "loading"
        : state.status;
  return { status, candidates: status === "ready" ? state.candidates : [], reload };
}
