import { useCallback, useEffect, useRef, useState } from "react";
import { codexAccountStateSchema, type CodexAccountState } from "@zcode/shared";
import { useServices } from "@/hooks/useServices.js";
import { useZCodeTaskService } from "@/hooks/useZCodeTaskService.js";
import type { CodexAccountView } from "./contract.js";

const LOGIN_POLL_INTERVAL_MS = 1500;
type AccountAction = Parameters<CodexAccountView["run"]>[0];

export function useCodexAccount(workspacePath = ""): CodexAccountView {
  // 设置页已注入唯一的配置 Environment；再次按活动远程项目解析，会把账号操作发给另一台机器。
  const service = useZCodeTaskService();
  const { fileService } = useServices();
  const [scope, setScope] = useState<{
    owner: typeof service;
    files: typeof fileService;
    requestedPath: string;
    cwd: string;
  } | null>(null);
  const cwd =
    scope?.owner === service && scope.files === fileService && scope.requestedPath === workspacePath
      ? scope.cwd
      : "";
  const [state, setState] = useState<CodexAccountState | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [pathAttempt, setPathAttempt] = useState(0);
  const generation = useRef(0);
  const mounted = useRef(false);
  const mutationPending = useRef<number | null>(null);
  const readPending = useRef<number | null>(null);
  const loginId = useRef<string | undefined>(undefined);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    generation.current++;
    mutationPending.current = null;
    readPending.current = null;
    setBusy(false);
    loginId.current = undefined;
    setState(null);
    setFailed(false);
    setScope(null);
    const readPath = workspacePath.trim()
      ? Promise.resolve(workspacePath)
      : fileService.ensureConversationWorkspace().then((result) => result.path);
    void readPath.then(
      (path) => {
        if (!disposed && path.trim())
          setScope({ owner: service, files: fileService, requestedPath: workspacePath, cwd: path });
        else if (!disposed) setFailed(true);
      },
      () => {
        if (!disposed) setFailed(true);
      },
    );
    return () => {
      disposed = true;
      mounted.current = false;
      generation.current++;
    };
  }, [workspacePath, service, fileService, pathAttempt]);

  const perform = useCallback(
    async (action: AccountAction, quiet = false) => {
      if (!cwd || mutationPending.current || (quiet && readPending.current)) return;
      const requestGeneration = ++generation.current;
      if (quiet) readPending.current = requestGeneration;
      else {
        mutationPending.current = requestGeneration;
        setBusy(true);
      }
      try {
        if (!service.codexAccount) throw new Error("Codex account capability unavailable");
        const result = codexAccountStateSchema.parse(
          await service.codexAccount({
            workspacePath: cwd,
            action,
            ...(action === "cancel" && loginId.current ? { loginId: loginId.current } : {}),
          }),
        );
        if (!mounted.current || generation.current !== requestGeneration) return;
        loginId.current = result.login?.loginId;
        setState(result);
        setFailed(false);
      } catch {
        // 原始 RPC/上游错误可能含认证数据；界面只显示固定的本地化提示，不回显异常文本。
        if (mounted.current && generation.current === requestGeneration) {
          setFailed(true);
          setState(null);
        }
      } finally {
        if (quiet) {
          if (readPending.current === requestGeneration) readPending.current = null;
        } else {
          if (mutationPending.current === requestGeneration) mutationPending.current = null;
          if (mounted.current && generation.current === requestGeneration) setBusy(false);
        }
      }
    },
    [cwd, service],
  );

  useEffect(() => {
    if (cwd) void perform("read", true);
  }, [cwd, perform]);
  useEffect(() => {
    if (state?.status !== "logging-in") return;
    const timer = setInterval(() => {
      void perform("read", true);
    }, LOGIN_POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [state?.status, perform]);
  const run = useCallback(
    async (action: AccountAction) => {
      if (!cwd) {
        setPathAttempt((attempt) => attempt + 1);
        return;
      }
      await perform(action);
    },
    [cwd, perform],
  );
  return { state, busy, failed, run };
}
