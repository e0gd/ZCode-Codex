/* oxlint-disable eslint(max-lines) -- settings helper 聚合多个设置分组；终端、网络与自动归档多侧能力暂时超过行数限制。 */
import type {
  AppSettings,
  AppToolSearchMode,
  IntegratedTerminalShellOption,
  IntegratedTerminalShellSelection,
  LocalePreference,
  ZCodeInteractionBehavior,
} from "@zcode/shared";
import {
  appToolSearchModeSchema,
  getCodexSkillPathKey,
  createCodexSkillSelector,
} from "@zcode/shared";
import {
  TID_SETTINGS_ASK_USER_QUESTION_AUTO_RESOLUTION_SWITCH,
  TID_SETTINGS_NATIVE_SEARCH_SWITCH,
  TID_SETTINGS_TOOL_SEARCH_SELECT,
  TID_SETTINGS_TOOL_SEARCH_OPTION,
} from "@zcode/shared/test-ids";
import { useState, useCallback, useEffect } from "react";
import { ChevronRight } from "lucide-react";
import type { IPlatformService } from "@zcode/shared";
import {
  TID_SETTINGS_LOCALE_SELECT_ITEM,
  TID_SETTINGS_LOCALE_SELECT_TRIGGER,
  testId,
} from "@zcode/shared/test-ids";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.js";
import { Switch } from "@/components/ui/switch.js";
import { Input } from "@/components/ui/input.js";
import { SettingsFormTextarea } from "@/settings/SettingsFormTextarea.js";
import { Button } from "@/components/ui/button.js";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible.js";
import { SettingsBadge, SettingsGroupCard, SettingsRow } from "@/settings/SettingsPageParts.js";
import { DataBaseDirControl } from "@/settings/DataBaseDirControl.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { useOptionalServices } from "@/hooks/useServices.js";
import {
  useCodexMcpSyncCandidates,
  useCodexSkillSyncCandidates,
} from "@/hooks/useEnsureWorkspaceMcpLoaded.js";
import { ProactiveSuggestionsSetting } from "@/settings/ProactiveSuggestionsSetting.js";
import { DynamicWorkflowModeSetting } from "@/settings/DynamicWorkflowModeSetting.js";
import { normalizeInterfaceMode, type InterfaceMode } from "@/lib/interfaceMode.js";
import {
  createSettingsPageConfig,
  resolveSettingsSectionForPlatform,
  SETTINGS_SECTION_GROUPS,
  SETTINGS_SECTIONS,
  isSettingsSectionAvailable,
  type SettingsSectionId,
} from "@/settings/settingsPageConfig.js";

export type { Locale, LocalePreference } from "@zcode/shared";
export { type SettingsSectionId };
export { createSettingsPageConfig, resolveSettingsSectionForPlatform };
export { SETTINGS_SECTION_GROUPS, SETTINGS_SECTIONS };
export { isSettingsSectionAvailable };

export function CodexSubagentsSettings({
  enabled,
  loading = false,
  onChange,
}: {
  enabled: boolean;
  loading?: boolean;
  onChange: (enabled: boolean) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const change = async (next: boolean) => {
    setSaving(true);
    setFailed(false);
    try {
      await onChange(next);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section
      className="space-y-2"
      aria-label={intl.formatMessage({ id: "settings.codex.collaboration" })}
    >
      <h3 className="text-ui-base font-medium text-foreground">
        {intl.formatMessage({ id: "settings.codex.collaboration" })}
      </h3>
      <SettingsGroupCard>
        <SettingsRow
          controlLayout="wide"
          label={intl.formatMessage({ id: "settings.codex.autoSubagents" })}
          description={intl.formatMessage({ id: "settings.codex.autoSubagentsDescription" })}
          control={
            <Switch
              // Radix 用 data-state 标记选中态；显式显示开启颜色与滑块位置。
              className="data-[state=checked]:bg-primary [&[data-state=checked]_[data-slot=switch-thumb]]:translate-x-[calc(100%-2px)]"
              checked={enabled}
              disabled={loading || saving}
              onCheckedChange={change}
              aria-label={intl.formatMessage({ id: "settings.codex.autoSubagents" })}
            />
          }
        />
      </SettingsGroupCard>
      <p className="text-ui-sm text-foreground-subtle">
        {intl.formatMessage({ id: "settings.codex.autoSubagentsScope" })}
      </p>
      {failed ? (
        <p role="alert" className="text-ui-sm text-foreground">
          {intl.formatMessage({ id: "settings.codex.saveFailed" })}
        </p>
      ) : null}
    </section>
  );
}

type CodexResourcePreferences = Pick<
  AppSettings,
  | "codexMcpConfigPath"
  | "codexSkillRoots"
  | "codexSyncMcp"
  | "codexUseNativeMcp"
  | "codexSyncSkills"
  | "codexMcpDisabledServers"
  | "codexSkillDisabledPaths"
  | "codexSkillEnabledPaths"
>;
const CODEX_RESOURCE_PATH_MAX_LENGTH = 4096;
const CODEX_SKILL_ROOT_MAX_COUNT = 32;
// 同步资源可能有数百项；限制列表高度，避免把保存操作推到长页面末尾。
const CODEX_RESOURCE_CATALOG_LIST_CLASSNAME =
  "max-h-72 overflow-y-auto overscroll-contain divide-y divide-border pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-input-border-focused";

export function CodexResourcesSettings({
  settings,
  onSave,
  workspacePath,
  workspaceIdentity,
}: {
  settings: CodexResourcePreferences | null;
  onSave: (patch: CodexResourcePreferences) => Promise<void>;
  workspacePath?: string;
  workspaceIdentity?: string;
}) {
  const { intl } = useZCodeIntl();
  const [mcpPath, setMcpPath] = useState("");
  const [skillDirectories, setSkillDirectories] = useState("");
  const [syncMcp, setSyncMcp] = useState(false);
  const [useNativeMcp, setUseNativeMcp] = useState(true);
  const [syncSkills, setSyncSkills] = useState(false);
  const [disabledServers, setDisabledServers] = useState<string[]>([]);
  const [disabledSkillPaths, setDisabledSkillPaths] = useState<string[]>([]);
  const [enabledSkillPaths, setEnabledSkillPaths] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [saved, setSaved] = useState(false);
  const storedMcpPath = settings?.codexMcpConfigPath ?? "";
  const storedSkillDirectories = (settings?.codexSkillRoots ?? []).join("\n");
  const storedSyncMcp = settings?.codexSyncMcp === true;
  const storedUseNativeMcp = settings?.codexUseNativeMcp !== false;
  const storedSyncSkills = settings?.codexSyncSkills === true;
  const storedDisabledServers = JSON.stringify(settings?.codexMcpDisabledServers ?? []);
  const storedDisabledSkillPaths = JSON.stringify(settings?.codexSkillDisabledPaths ?? []);
  const storedEnabledSkillPaths = JSON.stringify(settings?.codexSkillEnabledPaths ?? []);
  const catalog = useCodexMcpSyncCandidates(syncMcp, workspacePath, workspaceIdentity);
  const skillCatalog = useCodexSkillSyncCandidates(syncSkills, workspacePath, workspaceIdentity);
  const selectSkill = createCodexSkillSelector({
    codexSkillDisabledPaths: disabledSkillPaths,
    codexSkillEnabledPaths: enabledSkillPaths,
  });
  useEffect(() => {
    // 只跟随资源权威字段，避免其他设置广播清掉未提交的路径和 MCP 选择草稿。
    setMcpPath(storedMcpPath);
    setSkillDirectories(storedSkillDirectories);
    setSyncMcp(storedSyncMcp);
    setUseNativeMcp(storedUseNativeMcp);
    setSyncSkills(storedSyncSkills);
    setDisabledServers(JSON.parse(storedDisabledServers) as string[]);
    setDisabledSkillPaths(JSON.parse(storedDisabledSkillPaths) as string[]);
    setEnabledSkillPaths(JSON.parse(storedEnabledSkillPaths) as string[]);
  }, [
    storedMcpPath,
    storedSkillDirectories,
    storedSyncMcp,
    storedUseNativeMcp,
    storedSyncSkills,
    storedDisabledServers,
    storedDisabledSkillPaths,
    storedEnabledSkillPaths,
  ]);
  const skillRoots = [
    ...new Set(
      skillDirectories
        .split(/\r?\n/)
        .map((path) => path.trim())
        .filter(Boolean),
    ),
  ];
  const invalidSkills =
    skillRoots.length > CODEX_SKILL_ROOT_MAX_COUNT ||
    skillRoots.some((path) => path.length > CODEX_RESOURCE_PATH_MAX_LENGTH);
  const unavailable = !settings || saving;
  const edited = () => {
    setFailed(false);
    setSaved(false);
  };
  const save = async () => {
    setSaving(true);
    setFailed(false);
    setSaved(false);
    try {
      await onSave({
        codexMcpConfigPath: mcpPath.trim(),
        codexSkillRoots: skillRoots,
        codexSyncMcp: syncMcp,
        codexUseNativeMcp: useNativeMcp,
        codexSyncSkills: syncSkills,
        codexMcpDisabledServers: disabledServers,
        codexSkillDisabledPaths: disabledSkillPaths,
        codexSkillEnabledPaths: enabledSkillPaths,
      });
      setSaved(true);
    } catch {
      setFailed(true);
    } finally {
      setSaving(false);
    }
  };
  return (
    <section
      className="min-w-0 space-y-4"
      aria-label={intl.formatMessage({ id: "settings.codex.resources.title" })}
    >
      <p className="text-ui-base leading-6 text-foreground-subtle">
        {intl.formatMessage({ id: "settings.codex.resources.description" })}
      </p>
      <SettingsGroupCard>
        <SettingsRow
          controlLayout="wide"
          label={intl.formatMessage({ id: "settings.codex.resources.nativeMcp" })}
          description={intl.formatMessage({ id: "settings.codex.resources.nativeMcpDescription" })}
          control={
            <Switch
              data-testid="codex-use-native-mcp"
              className="data-[state=checked]:bg-primary [&[data-state=checked]_[data-slot=switch-thumb]]:translate-x-[calc(100%-2px)]"
              aria-label={intl.formatMessage({ id: "settings.codex.resources.nativeMcp" })}
              checked={useNativeMcp}
              disabled={unavailable}
              onCheckedChange={(value) => {
                edited();
                setUseNativeMcp(value);
              }}
            />
          }
        />
        <SettingsRow
          controlLayout="wide"
          label={intl.formatMessage({ id: "settings.codex.resources.mcpSync" })}
          description={intl.formatMessage({ id: "settings.codex.resources.mcpSyncDescription" })}
          control={
            <Switch
              data-testid="codex-sync-mcp"
              className="data-[state=checked]:bg-primary [&[data-state=checked]_[data-slot=switch-thumb]]:translate-x-[calc(100%-2px)]"
              aria-label={intl.formatMessage({ id: "settings.codex.resources.mcpSync" })}
              checked={syncMcp}
              disabled={unavailable}
              onCheckedChange={(value) => {
                edited();
                setSyncMcp(value);
              }}
            />
          }
        />
        {syncMcp ? (
          <Collapsible className="border-t border-border px-4 py-3" data-testid="codex-mcp-catalog">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="min-w-0 flex-1 text-ui-base font-medium text-foreground">
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="group h-auto min-h-9 w-full justify-start gap-2 whitespace-normal px-0 text-left"
                    data-testid="codex-mcp-catalog-toggle"
                  >
                    <ChevronRight
                      className="size-4 transition-transform group-data-[state=open]:rotate-90"
                      aria-hidden="true"
                    />
                    <span>{intl.formatMessage({ id: "settings.codex.resources.mcpList" })}</span>
                    {catalog.status === "ready" ? (
                      <span className="text-foreground-subtle">({catalog.candidates.length})</span>
                    ) : null}
                  </Button>
                </CollapsibleTrigger>
              </h3>
              {catalog.status === "ready" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="codex-mcp-catalog-refresh"
                  disabled={unavailable}
                  onClick={catalog.reload}
                >
                  {intl.formatMessage({ id: "settings.codex.resources.mcpRefresh" })}
                </Button>
              ) : null}
            </div>
            <CollapsibleContent>
              <div className="space-y-3 pt-3">
                <p className="text-ui-sm leading-5 text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.codex.resources.mcpListDescription" })}
                </p>
                {catalog.status === "loading" ? (
                  <p
                    className="text-ui-sm text-foreground-subtle"
                    data-testid="codex-mcp-catalog-loading"
                  >
                    {intl.formatMessage({ id: "settings.codex.resources.mcpLoading" })}
                  </p>
                ) : catalog.status === "unavailable" ? (
                  <p
                    className="text-ui-sm text-foreground-subtle"
                    data-testid="codex-mcp-catalog-unavailable"
                  >
                    {intl.formatMessage({ id: "settings.codex.resources.mcpUnavailable" })}
                  </p>
                ) : catalog.status === "error" ? (
                  <div className="space-y-2" data-testid="codex-mcp-catalog-error">
                    <p role="alert" className="text-ui-sm text-foreground">
                      {intl.formatMessage({ id: "settings.codex.resources.mcpLoadFailed" })}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="codex-mcp-catalog-retry"
                      onClick={catalog.reload}
                    >
                      {intl.formatMessage({ id: "settings.codex.resources.mcpRetry" })}
                    </Button>
                  </div>
                ) : catalog.candidates.length === 0 ? (
                  <p
                    className="text-ui-sm text-foreground-subtle"
                    data-testid="codex-mcp-catalog-empty"
                  >
                    {intl.formatMessage({ id: "settings.codex.resources.mcpEmpty" })}
                  </p>
                ) : (
                  <div
                    className={CODEX_RESOURCE_CATALOG_LIST_CLASSNAME}
                    data-testid="codex-mcp-catalog-list"
                    role="region"
                    aria-label={intl.formatMessage({ id: "settings.codex.resources.mcpList" })}
                    tabIndex={0}
                  >
                    {catalog.candidates.map((candidate) => {
                      const selectable = candidate.compatible && candidate.enabled;
                      const reason =
                        candidate.reason ??
                        (!candidate.enabled
                          ? "disabled"
                          : candidate.compatible
                            ? "compatible"
                            : "invalid_config");
                      return (
                        <div
                          key={candidate.name}
                          className="flex min-w-0 items-start justify-between gap-3 py-3"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="break-all text-ui-base font-medium text-foreground">
                              {candidate.name}
                            </p>
                            <p className="text-ui-sm leading-5 text-foreground-subtle">
                              {intl.formatMessage({
                                id: `settings.codex.resources.mcpReason.${reason}`,
                              })}
                            </p>
                          </div>
                          <Switch
                            data-testid="codex-mcp-candidate"
                            data-name={candidate.name}
                            className="mt-0.5 shrink-0 data-[state=checked]:bg-primary [&[data-state=checked]_[data-slot=switch-thumb]]:translate-x-[calc(100%-2px)]"
                            checked={selectable && !disabledServers.includes(candidate.name)}
                            disabled={unavailable || !selectable}
                            aria-label={intl.formatMessage(
                              { id: "settings.codex.resources.mcpSelect" },
                              { name: candidate.name },
                            )}
                            onCheckedChange={(value) => {
                              edited();
                              setDisabledServers((current) =>
                                value
                                  ? current.filter((name) => name !== candidate.name)
                                  : [...new Set([...current, candidate.name])],
                              );
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
        <div className="space-y-2 border-t border-border px-4 py-3">
          <label
            htmlFor="codex-mcp-config-path"
            className="text-ui-base font-medium text-foreground"
          >
            {intl.formatMessage({ id: "settings.codex.resources.mcpPath" })}
          </label>
          <Input
            id="codex-mcp-config-path"
            data-testid="codex-mcp-config-path"
            aria-describedby="codex-mcp-config-description"
            className="w-full min-w-0 text-mobile-input-safe md:text-ui-base"
            value={mcpPath}
            maxLength={CODEX_RESOURCE_PATH_MAX_LENGTH}
            placeholder={intl.formatMessage({ id: "settings.codex.resources.defaultPath" })}
            disabled={unavailable || syncMcp}
            onChange={(event) => {
              edited();
              setMcpPath(event.target.value);
            }}
          />
          <p
            id="codex-mcp-config-description"
            className="text-ui-sm leading-5 text-foreground-subtle"
          >
            {intl.formatMessage({ id: "settings.codex.resources.mcpPathDescription" })}
          </p>
        </div>
      </SettingsGroupCard>
      <SettingsGroupCard>
        <SettingsRow
          controlLayout="wide"
          label={intl.formatMessage({ id: "settings.codex.resources.skillsSync" })}
          description={intl.formatMessage({ id: "settings.codex.resources.skillsSyncDescription" })}
          control={
            <Switch
              data-testid="codex-sync-skills"
              className="data-[state=checked]:bg-primary [&[data-state=checked]_[data-slot=switch-thumb]]:translate-x-[calc(100%-2px)]"
              aria-label={intl.formatMessage({ id: "settings.codex.resources.skillsSync" })}
              checked={syncSkills}
              disabled={unavailable}
              onCheckedChange={(value) => {
                edited();
                setSyncSkills(value);
              }}
            />
          }
        />
        {syncSkills ? (
          <Collapsible
            className="border-t border-border px-4 py-3"
            data-testid="codex-skill-catalog"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="min-w-0 flex-1 text-ui-base font-medium text-foreground">
                <CollapsibleTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    className="group h-auto min-h-9 w-full justify-start gap-2 whitespace-normal px-0 text-left"
                    data-testid="codex-skill-catalog-toggle"
                  >
                    <ChevronRight
                      className="size-4 transition-transform group-data-[state=open]:rotate-90"
                      aria-hidden="true"
                    />
                    <span>{intl.formatMessage({ id: "settings.codex.resources.skillList" })}</span>
                    {skillCatalog.status === "ready" ? (
                      <span className="text-foreground-subtle">
                        ({skillCatalog.candidates.length})
                      </span>
                    ) : null}
                  </Button>
                </CollapsibleTrigger>
              </h3>
              {skillCatalog.status === "ready" ? (
                <Button
                  variant="ghost"
                  size="sm"
                  data-testid="codex-skill-catalog-refresh"
                  disabled={unavailable}
                  onClick={skillCatalog.reload}
                >
                  {intl.formatMessage({ id: "settings.codex.resources.skillRefresh" })}
                </Button>
              ) : null}
            </div>
            <CollapsibleContent>
              <div className="space-y-3 pt-3">
                <p className="text-ui-sm leading-5 text-foreground-subtle">
                  {intl.formatMessage({ id: "settings.codex.resources.skillListDescription" })}
                </p>
                {skillCatalog.status === "loading" ? (
                  <p
                    className="text-ui-sm text-foreground-subtle"
                    data-testid="codex-skill-catalog-loading"
                  >
                    {intl.formatMessage({ id: "settings.codex.resources.skillLoading" })}
                  </p>
                ) : skillCatalog.status === "unavailable" ? (
                  <p
                    className="text-ui-sm text-foreground-subtle"
                    data-testid="codex-skill-catalog-unavailable"
                  >
                    {intl.formatMessage({ id: "settings.codex.resources.skillUnavailable" })}
                  </p>
                ) : skillCatalog.status === "error" ? (
                  <div className="space-y-2" data-testid="codex-skill-catalog-error">
                    <p role="alert" className="text-ui-sm text-foreground">
                      {intl.formatMessage({ id: "settings.codex.resources.skillLoadFailed" })}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      data-testid="codex-skill-catalog-retry"
                      disabled={unavailable}
                      onClick={skillCatalog.reload}
                    >
                      {intl.formatMessage({ id: "settings.codex.resources.skillRetry" })}
                    </Button>
                  </div>
                ) : skillCatalog.candidates.length === 0 ? (
                  <p
                    className="text-ui-sm text-foreground-subtle"
                    data-testid="codex-skill-catalog-empty"
                  >
                    {intl.formatMessage({ id: "settings.codex.resources.skillEmpty" })}
                  </p>
                ) : (
                  <div
                    className={CODEX_RESOURCE_CATALOG_LIST_CLASSNAME}
                    data-testid="codex-skill-catalog-list"
                    role="region"
                    aria-label={intl.formatMessage({ id: "settings.codex.resources.skillList" })}
                    tabIndex={0}
                  >
                    {skillCatalog.candidates.map((candidate) => {
                      const candidateKey = getCodexSkillPathKey(candidate.path);
                      const selected = selectSkill(candidate);
                      return (
                        <div
                          key={candidateKey}
                          className="flex min-w-0 items-start justify-between gap-3 py-3"
                        >
                          <div className="min-w-0 flex-1 space-y-1">
                            <p className="break-all text-ui-base font-medium text-foreground">
                              {candidate.name}
                            </p>
                            <p className="break-all text-ui-sm leading-5 text-foreground-subtle">
                              {intl.formatMessage({
                                id: `settings.codex.resources.skillScope.${candidate.scope}`,
                              })}
                              {candidate.pluginName ? ` · ${candidate.pluginName}` : ""}
                            </p>
                            <p className="break-all text-ui-sm leading-5 text-foreground-subtle">
                              {candidate.path}
                            </p>
                            {!candidate.enabled ? (
                              <p className="text-ui-sm leading-5 text-foreground-subtle">
                                {intl.formatMessage({
                                  id: "settings.codex.resources.skillDisabled",
                                })}
                              </p>
                            ) : null}
                            {candidate.incompatibleMcpServers?.length ? (
                              <p
                                data-testid="codex-skill-mcp-warning"
                                className="break-all text-ui-sm leading-5 text-warning"
                              >
                                {intl.formatMessage(
                                  { id: "settings.codex.resources.skillMcpIncompatible" },
                                  { names: candidate.incompatibleMcpServers.join(", ") },
                                )}
                              </p>
                            ) : null}
                          </div>
                          <Switch
                            data-testid="codex-skill-candidate"
                            data-name={candidate.name}
                            data-path={candidate.path}
                            className="mt-0.5 shrink-0 data-[state=checked]:bg-primary [&[data-state=checked]_[data-slot=switch-thumb]]:translate-x-[calc(100%-2px)]"
                            checked={selected}
                            disabled={unavailable || !candidate.enabled}
                            aria-label={intl.formatMessage(
                              { id: "settings.codex.resources.skillSelect" },
                              { name: candidate.name, path: candidate.path },
                            )}
                            onCheckedChange={(value) => {
                              edited();
                              setDisabledSkillPaths((current) =>
                                value
                                  ? current.filter(
                                      (path) => getCodexSkillPathKey(path) !== candidateKey,
                                    )
                                  : current.some(
                                        (path) => getCodexSkillPathKey(path) === candidateKey,
                                      )
                                    ? current
                                    : [...current, candidate.path],
                              );
                              setEnabledSkillPaths((current) =>
                                value
                                  ? current.some(
                                      (path) => getCodexSkillPathKey(path) === candidateKey,
                                    )
                                    ? current
                                    : [...current, candidate.path]
                                  : current.filter(
                                      (path) => getCodexSkillPathKey(path) !== candidateKey,
                                    ),
                              );
                            }}
                          />
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </CollapsibleContent>
          </Collapsible>
        ) : null}
        <div className="space-y-2 border-t border-border px-4 py-3">
          <label htmlFor="codex-skill-roots" className="text-ui-base font-medium text-foreground">
            {intl.formatMessage({ id: "settings.codex.resources.skillRoots" })}
          </label>
          <SettingsFormTextarea
            id="codex-skill-roots"
            data-testid="codex-skill-roots"
            aria-describedby="codex-skill-roots-description"
            aria-invalid={invalidSkills || undefined}
            rows={3}
            className="text-mobile-input-safe md:text-ui-base"
            value={skillDirectories}
            placeholder={intl.formatMessage({ id: "settings.codex.resources.defaultSkills" })}
            disabled={unavailable || syncSkills}
            onChange={(event) => {
              edited();
              setSkillDirectories(event.target.value);
            }}
          />
          <p
            id="codex-skill-roots-description"
            className="text-ui-sm leading-5 text-foreground-subtle"
          >
            {intl.formatMessage({ id: "settings.codex.resources.skillRootsDescription" })}
          </p>
        </div>
      </SettingsGroupCard>
      <p className="text-ui-sm leading-5 text-foreground-subtle">
        {intl.formatMessage({ id: "settings.codex.resources.scope" })}
      </p>
      {invalidSkills ? (
        <p role="alert" className="text-ui-sm text-foreground">
          {intl.formatMessage({ id: "settings.codex.resources.invalidSkills" })}
        </p>
      ) : null}
      {failed ? (
        <p role="alert" className="text-ui-sm text-foreground">
          {intl.formatMessage({ id: "settings.codex.resources.saveFailed" })}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="text-ui-sm text-foreground-subtle">
          {intl.formatMessage({ id: "settings.codex.resources.saved" })}
        </p>
      ) : null}
      <Button
        data-testid="codex-resources-save"
        disabled={unavailable || invalidSkills}
        onClick={() => void save()}
      >
        {intl.formatMessage({ id: "common.saveChanges" })}
      </Button>
    </section>
  );
}

const TASK_AUTO_ARCHIVE_DAY_OPTIONS = [3, 7, 14, 30] as const;
const ZCODE_INTERACTION_BEHAVIOR_OPTIONS: readonly ZCodeInteractionBehavior[] = ["queue", "guide"];

/**
 * 归档偏好与归档列表集中展示，设置值和保存动作继续由 SettingsPage 持有。
 * Bugfix：关闭时禁用时长会迫使用户先开启归档，旧阈值可能立即生效；允许先保存时长再开启。
 */
export function TaskAutoArchiveSettings({
  taskAutoArchiveEnabled,
  taskAutoArchiveOlderThanDays,
  onTaskAutoArchiveEnabledChange,
  onTaskAutoArchiveOlderThanDaysChange,
}: {
  taskAutoArchiveEnabled: boolean;
  taskAutoArchiveOlderThanDays: number;
  onTaskAutoArchiveEnabledChange: (enabled: boolean) => Promise<void>;
  onTaskAutoArchiveOlderThanDaysChange: (days: number) => Promise<void>;
}) {
  const { intl } = useZCodeIntl();
  return (
    <SettingsGroupCard>
      <SettingsRow
        controlLayout="wide"
        label={intl.formatMessage({ id: "settings.taskAutoArchive" })}
        description={intl.formatMessage({
          id: "settings.taskAutoArchiveDescription",
        })}
        control={
          <Switch
            data-testid="archive-auto-archive-switch"
            aria-label={intl.formatMessage({ id: "settings.taskAutoArchive" })}
            checked={taskAutoArchiveEnabled}
            onCheckedChange={(checked) => {
              void onTaskAutoArchiveEnabledChange(checked);
            }}
          />
        }
      />
      <SettingsRow
        controlLayout="wide"
        label={intl.formatMessage({ id: "settings.taskAutoArchiveDays" })}
        description={intl.formatMessage({
          id: "settings.taskAutoArchiveDaysDescription",
        })}
        control={
          <Select
            value={String(taskAutoArchiveOlderThanDays)}
            onValueChange={(value) => {
              void onTaskAutoArchiveOlderThanDaysChange(Number(value));
            }}
          >
            <SelectTrigger
              data-testid="archive-auto-archive-days"
              aria-label={intl.formatMessage({ id: "settings.taskAutoArchiveDays" })}
              size="lg"
              className="w-full min-w-0 justify-between"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TASK_AUTO_ARCHIVE_DAY_OPTIONS.map((days) => (
                <SelectItem key={days} value={String(days)}>
                  {intl.formatMessage({
                    id: `settings.taskAutoArchiveDays.option.${days}`,
                  })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </SettingsGroupCard>
  );
}

export function GeneralSectionContent({
  localePreference,
  interfaceMode = "coding",
  setInterfaceMode = () => {},
  notificationEnabled,
  notificationSoundEnabled,
  closeToTrayOnWindows,
  keepAwakeWhileRunning = false,
  desktopChromiumHardwareAccelerationEnabled = true,
  receivePreviewUpdates,
  autoDownloadAndInstallUpdates,
  dataBaseDir,
  terminalInheritSystemProfile = true,
  terminalFontFamily = "",
  integratedTerminalShell = { mode: "auto" },
  integratedTerminalShellOptions = [],
  toolSearchMode = "off",
  onToolSearchModeChange,
  nativeSearchEnhancementsEnabled,
  httpProxy = "",
  httpProxyNoProxy = "",
  httpProxyCaCertPath = "",
  defaultHomeDir,
  isDesktop,
  isWindowsDesktop,
  isLinuxDesktop,
  linuxCloseToTray,
  showIntegratedTerminalShell = false,
  setLocalePreference,
  setNotificationEnabled,
  setNotificationSoundEnabled,
  messageStreamShowReasoning,
  messageStreamShowTodos,
  toolGroupingExploreEnabled,
  toolGroupingTerminalEnabled,
  toolGroupingChangesEnabled,
  zcodeInteractionBehavior,
  askUserQuestionAutoResolutionEnabled = true,
  modelIoFullRetentionEnabled = false,
  onDataBaseDirChange,
  onSelectDataBaseDir,
  onTerminalInheritSystemProfileChange = async () => {},
  onTerminalFontFamilyChange = async () => {},
  onIntegratedTerminalShellChange = async () => {},
  onNativeSearchEnhancementsEnabledChange,
  onHttpProxyChange = async () => {},
  onHttpProxyNoProxyChange = async () => {},
  onHttpProxyCaCertPathChange = async () => {},
  onCloseToTrayOnWindowsChange,
  onKeepAwakeWhileRunningChange = async () => {},
  onDesktopChromiumHardwareAccelerationChange = async () => {},
  onReceivePreviewUpdatesChange,
  onAutoDownloadAndInstallUpdatesChange,
  onMessageStreamShowReasoningChange,
  onMessageStreamShowTodosChange,
  onToolGroupingExploreEnabledChange,
  onToolGroupingTerminalEnabledChange,
  onToolGroupingChangesEnabledChange,
  onZCodeInteractionBehaviorChange,
  onAskUserQuestionAutoResolutionEnabledChange = async () => {},
  onModelIoFullRetentionEnabledChange = async () => {},
  onOpenOnboardingDialog,
}: {
  localePreference: LocalePreference;
  interfaceMode?: InterfaceMode;
  setInterfaceMode?: (mode: InterfaceMode) => void;
  notificationEnabled: boolean;
  notificationSoundEnabled: boolean;
  closeToTrayOnWindows: boolean;
  keepAwakeWhileRunning?: boolean;
  desktopChromiumHardwareAccelerationEnabled?: boolean;
  receivePreviewUpdates: boolean;
  autoDownloadAndInstallUpdates: boolean;
  dataBaseDir: string;
  terminalInheritSystemProfile: boolean;
  terminalFontFamily: string;
  integratedTerminalShell?: IntegratedTerminalShellSelection;
  integratedTerminalShellOptions?: IntegratedTerminalShellOption[];
  toolSearchMode?: AppToolSearchMode;
  onToolSearchModeChange: (mode: AppToolSearchMode) => Promise<void>;
  nativeSearchEnhancementsEnabled: boolean;
  httpProxy?: string;
  httpProxyNoProxy?: string;
  httpProxyCaCertPath?: string;
  defaultHomeDir: string;
  isDesktop?: boolean;
  isWindowsDesktop?: boolean;
  /** Linux 桌面端（isDesktop 且非 win/mac）；关闭驻留托盘设置在 Linux 上按能力自适应展示 */
  isLinuxDesktop?: boolean;
  /** Linux 关闭驻留托盘能力状态（spec：docs/desktop/linux-close-to-tray.md）；Windows 不传 */
  linuxCloseToTray?: {
    /** 能力探测中或确认不可用，开关锁定 */
    disabled: boolean;
    /** 确认不可用（描述文案切换为"未提供系统托盘"） */
    unavailable: boolean;
    /** GNOME 系桌面且无托盘（追加 AppIndicator 扩展安装提示） */
    gnomeLikeHint: boolean;
  };
  showIntegratedTerminalShell?: boolean;
  platform?: IPlatformService;
  setLocalePreference: (locale: LocalePreference) => void;
  setNotificationEnabled: (enabled: boolean) => void;
  setNotificationSoundEnabled: (enabled: boolean) => void;
  messageStreamShowReasoning: boolean;
  messageStreamShowTodos: boolean;
  toolGroupingExploreEnabled: boolean;
  toolGroupingTerminalEnabled: boolean;
  toolGroupingChangesEnabled: boolean;
  zcodeInteractionBehavior: ZCodeInteractionBehavior;
  askUserQuestionAutoResolutionEnabled?: boolean;
  modelIoFullRetentionEnabled?: boolean;
  onDataBaseDirChange: (dir: string) => Promise<void>;
  onSelectDataBaseDir: () => Promise<string | null>;
  onTerminalInheritSystemProfileChange: (enabled: boolean) => Promise<void>;
  onTerminalFontFamilyChange: (fontFamily: string) => Promise<void>;
  onIntegratedTerminalShellChange?: (selection: IntegratedTerminalShellSelection) => Promise<void>;
  onNativeSearchEnhancementsEnabledChange: (enabled: boolean) => Promise<void>;
  onHttpProxyChange?: (httpProxy: string) => Promise<void>;
  onHttpProxyNoProxyChange?: (noProxy: string) => Promise<void>;
  onHttpProxyCaCertPathChange?: (caCertPath: string) => Promise<void>;
  onCloseToTrayOnWindowsChange: (enabled: boolean) => Promise<void>;
  onKeepAwakeWhileRunningChange?: (enabled: boolean) => Promise<void>;
  onDesktopChromiumHardwareAccelerationChange?: (enabled: boolean) => Promise<void>;
  onReceivePreviewUpdatesChange: (enabled: boolean) => Promise<void>;
  onAutoDownloadAndInstallUpdatesChange: (enabled: boolean) => Promise<void>;
  onMessageStreamShowReasoningChange: (enabled: boolean) => Promise<void>;
  onMessageStreamShowTodosChange: (enabled: boolean) => Promise<void>;
  onToolGroupingExploreEnabledChange: (enabled: boolean) => Promise<void>;
  onToolGroupingTerminalEnabledChange: (enabled: boolean) => Promise<void>;
  onToolGroupingChangesEnabledChange: (enabled: boolean) => Promise<void>;
  onZCodeInteractionBehaviorChange: (behavior: ZCodeInteractionBehavior) => Promise<void>;
  onAskUserQuestionAutoResolutionEnabledChange?: (enabled: boolean) => Promise<void>;
  onModelIoFullRetentionEnabledChange?: (enabled: boolean) => Promise<void>;
  onOpenOnboardingDialog: () => void;
}) {
  const { intl } = useZCodeIntl();
  const hasServices = Boolean(useOptionalServices());
  // 部分 SSR 单测会用精简 props 直接渲染本组件，新增终端设置项后旧 helper 未必同步传值。
  // 这里把运行时缺省值兜到“继承系统 profile”，避免 undefined.trim() 把无关测试打断。
  const [localTerminalFontFamily, setLocalTerminalFontFamily] = useState(terminalFontFamily);

  useEffect(() => {
    setLocalTerminalFontFamily(terminalFontFamily);
  }, [terminalFontFamily]);

  const normalizedTerminalFontFamily = localTerminalFontFamily.trim();
  const isTerminalFontFamilyDirty = normalizedTerminalFontFamily !== terminalFontFamily;
  const integratedTerminalShellValue =
    integratedTerminalShell.mode === "shell" ? integratedTerminalShell.id : "auto";
  const selectedIntegratedTerminalShellOption =
    integratedTerminalShell.mode === "shell"
      ? (integratedTerminalShellOptions.find(
          (option) => option.id === integratedTerminalShell.id,
        ) ?? {
          dialect: integratedTerminalShell.dialect,
          id: integratedTerminalShell.id,
          label: integratedTerminalShell.label,
          path: integratedTerminalShell.path,
          source: "system" as const,
        })
      : undefined;
  const visibleIntegratedTerminalShellOptions = selectedIntegratedTerminalShellOption
    ? [
        selectedIntegratedTerminalShellOption,
        ...integratedTerminalShellOptions.filter(
          (option) => option.id !== selectedIntegratedTerminalShellOption.id,
        ),
      ]
    : integratedTerminalShellOptions;

  const handleTerminalFontFamilySave = useCallback(async () => {
    await onTerminalFontFamilyChange(normalizedTerminalFontFamily);
  }, [normalizedTerminalFontFamily, onTerminalFontFamilyChange]);

  const handleIntegratedTerminalShellChange = useCallback(
    async (value: string) => {
      if (value === "auto") {
        await onIntegratedTerminalShellChange({ mode: "auto" });
        return;
      }
      const option = visibleIntegratedTerminalShellOptions.find(
        (candidate) => candidate.id === value,
      );
      if (!option) {
        return;
      }
      await onIntegratedTerminalShellChange({
        mode: "shell",
        dialect: option.dialect,
        id: option.id,
        label: option.label,
        path: option.path,
      });
    },
    [onIntegratedTerminalShellChange, visibleIntegratedTerminalShellOptions],
  );

  const [localHttpProxy, setLocalHttpProxy] = useState(httpProxy);

  useEffect(() => {
    setLocalHttpProxy(httpProxy);
  }, [httpProxy]);

  const normalizedHttpProxy = localHttpProxy.trim();
  const isHttpProxyDirty = normalizedHttpProxy !== httpProxy;

  const handleHttpProxySave = useCallback(async () => {
    await onHttpProxyChange(normalizedHttpProxy);
  }, [normalizedHttpProxy, onHttpProxyChange]);

  const [localHttpProxyNoProxy, setLocalHttpProxyNoProxy] = useState(httpProxyNoProxy);

  useEffect(() => {
    setLocalHttpProxyNoProxy(httpProxyNoProxy);
  }, [httpProxyNoProxy]);

  const normalizedHttpProxyNoProxy = localHttpProxyNoProxy
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean)
    .join(",");
  const isHttpProxyNoProxyDirty = normalizedHttpProxyNoProxy !== httpProxyNoProxy;

  const handleHttpProxyNoProxySave = useCallback(async () => {
    await onHttpProxyNoProxyChange(normalizedHttpProxyNoProxy);
  }, [normalizedHttpProxyNoProxy, onHttpProxyNoProxyChange]);

  const [localHttpProxyCaCertPath, setLocalHttpProxyCaCertPath] = useState(httpProxyCaCertPath);

  useEffect(() => {
    setLocalHttpProxyCaCertPath(httpProxyCaCertPath);
  }, [httpProxyCaCertPath]);

  const normalizedHttpProxyCaCertPath = localHttpProxyCaCertPath.trim();
  const isHttpProxyCaCertPathDirty = normalizedHttpProxyCaCertPath !== httpProxyCaCertPath;

  const handleHttpProxyCaCertPathSave = useCallback(async () => {
    await onHttpProxyCaCertPathChange(normalizedHttpProxyCaCertPath);
  }, [normalizedHttpProxyCaCertPath, onHttpProxyCaCertPathChange]);

  return (
    <div className="space-y-4">
      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.locale" })}
          description={intl.formatMessage({ id: "settings.localeDescription" })}
          control={
            <Select
              value={localePreference}
              onValueChange={(value) => setLocalePreference(value as LocalePreference)}
            >
              <SelectTrigger
                size="lg"
                className="w-[260px] min-w-0 justify-between"
                data-testid={TID_SETTINGS_LOCALE_SELECT_TRIGGER}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  value="system"
                  data-testid={testId(TID_SETTINGS_LOCALE_SELECT_ITEM, "system")}
                >
                  {intl.formatMessage({ id: "settings.locale.system" })}
                </SelectItem>
                <SelectItem
                  value="zh-CN"
                  data-testid={testId(TID_SETTINGS_LOCALE_SELECT_ITEM, "zh-CN")}
                >
                  {intl.formatMessage({ id: "settings.locale.zh-CN" })}
                </SelectItem>
                <SelectItem
                  value="en-US"
                  data-testid={testId(TID_SETTINGS_LOCALE_SELECT_ITEM, "en-US")}
                >
                  {intl.formatMessage({ id: "settings.locale.en-US" })}
                </SelectItem>
              </SelectContent>
            </Select>
          }
        />
      </SettingsGroupCard>

      <SettingsGroupCard>
        <SettingsRow
          controlLayout="wide"
          label={intl.formatMessage({ id: "settings.interfaceMode" })}
          description={intl.formatMessage({ id: "settings.interfaceMode.description" })}
          control={
            <Select
              value={interfaceMode}
              onValueChange={(value) => setInterfaceMode(normalizeInterfaceMode(value))}
            >
              <SelectTrigger
                size="lg"
                className="w-full min-w-0 sm:w-64"
                aria-label={intl.formatMessage({ id: "settings.interfaceMode" })}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="coding">
                  {intl.formatMessage({ id: "settings.interfaceMode.coding" })}
                </SelectItem>
                <SelectItem value="office">
                  {intl.formatMessage({ id: "settings.interfaceMode.office" })}
                </SelectItem>
              </SelectContent>
            </Select>
          }
        />
        {hasServices ? <ProactiveSuggestionsSetting /> : null}
      </SettingsGroupCard>

      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.terminalProfile" })}
          description={intl.formatMessage({ id: "settings.terminalProfileDescription" })}
          control={
            <Switch
              checked={terminalInheritSystemProfile}
              onCheckedChange={(checked) => {
                void onTerminalInheritSystemProfileChange(checked);
              }}
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.terminalFontFamily" })}
          description={intl.formatMessage({ id: "settings.terminalFontFamilyDescription" })}
          control={
            <Button
              type="button"
              size="lg"
              disabled={!isTerminalFontFamilyDirty}
              onClick={() => void handleTerminalFontFamilySave()}
            >
              {intl.formatMessage({ id: "settings.dataBaseDirSave" })}
            </Button>
          }
          detail={
            <Input
              size="lg"
              value={localTerminalFontFamily}
              placeholder={intl.formatMessage({
                id: "settings.terminalFontFamilyPlaceholder",
              })}
              onChange={(event) => {
                setLocalTerminalFontFamily(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && isTerminalFontFamilyDirty) {
                  void handleTerminalFontFamilySave();
                }
              }}
              className="max-w-[520px] font-mono"
            />
          }
        />
      </SettingsGroupCard>

      <SettingsGroupCard>
        {showIntegratedTerminalShell ? (
          <SettingsRow
            label={intl.formatMessage({ id: "settings.integratedTerminalShell" })}
            description={intl.formatMessage({
              id: "settings.integratedTerminalShellDescription",
            })}
            control={
              <Select
                value={integratedTerminalShellValue}
                onValueChange={(value) => {
                  void handleIntegratedTerminalShellChange(value);
                }}
              >
                <SelectTrigger size="lg" className="w-[260px] min-w-0 justify-between">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">
                    {intl.formatMessage({ id: "settings.integratedTerminalShell.auto" })}
                  </SelectItem>
                  {visibleIntegratedTerminalShellOptions.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            }
          />
        ) : null}
        <SettingsRow
          label={intl.formatMessage({ id: "settings.toolSearch" })}
          description={intl.formatMessage({ id: "settings.toolSearchDescription" })}
          detail={
            <p className="text-ui-sm leading-5 text-foreground-subtle">
              {intl.formatMessage({ id: "settings.toolSearchExperimentalNotice" })}
            </p>
          }
          control={
            <Select
              value={toolSearchMode}
              onValueChange={(value) => {
                void onToolSearchModeChange(appToolSearchModeSchema.parse(value));
              }}
            >
              <SelectTrigger
                size="lg"
                className="w-[260px] min-w-0 justify-between"
                data-testid={TID_SETTINGS_TOOL_SEARCH_SELECT}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {appToolSearchModeSchema.options.map((mode) => (
                  <SelectItem
                    key={mode}
                    value={mode}
                    data-testid={testId(TID_SETTINGS_TOOL_SEARCH_OPTION, mode)}
                  >
                    {intl.formatMessage({ id: `settings.toolSearch.${mode}` })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          label={intl.formatMessage({
            id: "settings.nativeSearchEnhancements",
          })}
          description={intl.formatMessage({
            id: "settings.nativeSearchEnhancementsDescription",
          })}
          control={
            <Switch
              aria-label={intl.formatMessage({
                id: "settings.nativeSearchEnhancements",
              })}
              checked={nativeSearchEnhancementsEnabled}
              data-testid={TID_SETTINGS_NATIVE_SEARCH_SWITCH}
              onCheckedChange={(checked) => {
                void onNativeSearchEnhancementsEnabledChange(checked);
              }}
            />
          }
        />
      </SettingsGroupCard>

      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.httpProxy" })}
          description={intl.formatMessage({ id: "settings.httpProxyDescription" })}
          control={
            <Button
              type="button"
              size="lg"
              disabled={!isHttpProxyDirty}
              onClick={() => void handleHttpProxySave()}
            >
              {intl.formatMessage({ id: "settings.dataBaseDirSave" })}
            </Button>
          }
          detail={
            <Input
              size="lg"
              value={localHttpProxy}
              placeholder={intl.formatMessage({
                id: "settings.httpProxyPlaceholder",
              })}
              onChange={(event) => {
                setLocalHttpProxy(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && isHttpProxyDirty) {
                  void handleHttpProxySave();
                }
              }}
              className="max-w-[520px] font-mono"
            />
          }
        />
        {/* No Proxy 与 HTTP 代理共同决定同一出口策略，必须贴在代理地址下面。*/}
        <SettingsRow
          label={intl.formatMessage({ id: "settings.httpProxyNoProxy" })}
          description={intl.formatMessage({
            id: "settings.httpProxyNoProxyDescription",
          })}
          control={
            <Button
              type="button"
              size="lg"
              disabled={!isHttpProxyNoProxyDirty}
              onClick={() => void handleHttpProxyNoProxySave()}
            >
              {intl.formatMessage({ id: "settings.dataBaseDirSave" })}
            </Button>
          }
          detail={
            <Input
              size="lg"
              value={localHttpProxyNoProxy}
              placeholder={intl.formatMessage({
                id: "settings.httpProxyNoProxyPlaceholder",
              })}
              onChange={(event) => {
                setLocalHttpProxyNoProxy(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && isHttpProxyNoProxyDirty) {
                  void handleHttpProxyNoProxySave();
                }
              }}
              className="max-w-[520px] font-mono"
            />
          }
        />
        {/* 自定义 CA 属于 HTTP 代理的同一网络出口策略，必须跟代理输入放在同一卡片里。*/}
        <SettingsRow
          label={intl.formatMessage({ id: "settings.httpProxyCaCertPath" })}
          description={intl.formatMessage({
            id: "settings.httpProxyCaCertPathDescription",
          })}
          control={
            <Button
              type="button"
              size="lg"
              disabled={!isHttpProxyCaCertPathDirty}
              onClick={() => void handleHttpProxyCaCertPathSave()}
            >
              {intl.formatMessage({ id: "settings.dataBaseDirSave" })}
            </Button>
          }
          detail={
            <Input
              size="lg"
              value={localHttpProxyCaCertPath}
              placeholder={intl.formatMessage({
                id: "settings.httpProxyCaCertPathPlaceholder",
              })}
              onChange={(event) => {
                setLocalHttpProxyCaCertPath(event.currentTarget.value);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" && isHttpProxyCaCertPathDirty) {
                  void handleHttpProxyCaCertPathSave();
                }
              }}
              className="max-w-[520px] font-mono"
            />
          }
        />
      </SettingsGroupCard>

      <SettingsGroupCard>
        {isDesktop ? (
          <>
            <SettingsRow
              label={intl.formatMessage({
                id: "settings.desktopChromiumHardwareAcceleration",
              })}
              description={intl.formatMessage({
                id: "settings.desktopChromiumHardwareAccelerationDescription",
              })}
              control={
                <Switch
                  aria-label={intl.formatMessage({
                    id: "settings.desktopChromiumHardwareAcceleration",
                  })}
                  checked={desktopChromiumHardwareAccelerationEnabled}
                  onCheckedChange={(checked) => {
                    void onDesktopChromiumHardwareAccelerationChange(checked);
                  }}
                />
              }
            />
            <SettingsRow
              label={intl.formatMessage({ id: "settings.receivePreviewUpdates" })}
              description={intl.formatMessage({
                id: "settings.receivePreviewUpdatesDescription",
              })}
              control={
                <Switch
                  aria-label={intl.formatMessage({ id: "settings.receivePreviewUpdates" })}
                  checked={receivePreviewUpdates}
                  onCheckedChange={(checked) => {
                    void onReceivePreviewUpdatesChange(checked);
                  }}
                />
              }
            />
            <SettingsRow
              label={intl.formatMessage({
                id: "settings.autoDownloadAndInstallUpdates",
              })}
              description={intl.formatMessage({
                id: "settings.autoDownloadAndInstallUpdatesDescription",
              })}
              control={
                <Switch
                  aria-label={intl.formatMessage({
                    id: "settings.autoDownloadAndInstallUpdates",
                  })}
                  checked={autoDownloadAndInstallUpdates}
                  onCheckedChange={(checked) => {
                    void onAutoDownloadAndInstallUpdatesChange(checked);
                  }}
                />
              }
            />
          </>
        ) : null}
        <SettingsRow
          label={intl.formatMessage({ id: "settings.notification" })}
          description={intl.formatMessage({
            id: "settings.notificationDescription",
          })}
          control={
            <Switch checked={notificationEnabled} onCheckedChange={setNotificationEnabled} />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.notificationSound" })}
          description={intl.formatMessage({
            id: "settings.notificationSoundDescription",
          })}
          control={
            <Switch
              checked={notificationSoundEnabled}
              disabled={!notificationEnabled}
              onCheckedChange={setNotificationSoundEnabled}
            />
          }
        />
        {isWindowsDesktop || isLinuxDesktop ? (
          <SettingsRow
            label={intl.formatMessage({ id: "settings.closeToTrayOnWindows" })}
            description={
              linuxCloseToTray?.unavailable
                ? linuxCloseToTray.gnomeLikeHint
                  ? `${intl.formatMessage({ id: "settings.closeToTrayUnavailable" })} ${intl.formatMessage({ id: "settings.closeToTrayGnomeHint" })}`
                  : intl.formatMessage({ id: "settings.closeToTrayUnavailable" })
                : intl.formatMessage({
                    id: "settings.closeToTrayOnWindowsDescription",
                  })
            }
            control={
              <Switch
                checked={closeToTrayOnWindows}
                // Linux 上托盘能力未知（探测中）或确认不可用时都锁定，防止误开导致关窗失联
                //（spec：docs/desktop/linux-close-to-tray.md）。
                disabled={Boolean(linuxCloseToTray?.disabled)}
                onCheckedChange={(checked) => {
                  void onCloseToTrayOnWindowsChange(checked);
                }}
              />
            }
          />
        ) : null}
        {isDesktop ? (
          <SettingsRow
            label={intl.formatMessage({ id: "settings.keepAwakeWhileRunning" })}
            description={intl.formatMessage({
              id: "settings.keepAwakeWhileRunningDescription",
            })}
            control={
              <Switch
                aria-label={intl.formatMessage({
                  id: "settings.keepAwakeWhileRunning",
                })}
                checked={keepAwakeWhileRunning}
                onCheckedChange={(checked) => {
                  void onKeepAwakeWhileRunningChange(checked);
                }}
              />
            }
          />
        ) : null}
      </SettingsGroupCard>

      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.zcodeInteractionBehavior" })}
          description={intl.formatMessage({
            id: "settings.zcodeInteractionBehaviorDescription",
          })}
          control={
            <Select
              value={zcodeInteractionBehavior}
              onValueChange={(value) => {
                void onZCodeInteractionBehaviorChange(value as ZCodeInteractionBehavior);
              }}
            >
              <SelectTrigger size="lg" className="w-[260px] min-w-0 justify-between">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ZCODE_INTERACTION_BEHAVIOR_OPTIONS.map((behavior) => (
                  <SelectItem key={behavior} value={behavior}>
                    {intl.formatMessage({
                      id: `settings.zcodeInteractionBehavior.option.${behavior}`,
                    })}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <SettingsRow
          label={intl.formatMessage({
            id: "settings.askUserQuestionAutoResolution",
          })}
          description={intl.formatMessage({
            id: "settings.askUserQuestionAutoResolutionDescription",
          })}
          control={
            <Switch
              aria-label={intl.formatMessage({
                id: "settings.askUserQuestionAutoResolution",
              })}
              checked={askUserQuestionAutoResolutionEnabled}
              data-testid={TID_SETTINGS_ASK_USER_QUESTION_AUTO_RESOLUTION_SWITCH}
              onCheckedChange={(checked) => {
                void onAskUserQuestionAutoResolutionEnabledChange(checked);
              }}
            />
          }
        />
        {/* docs/dynamic-workflow/launch.md「The user's choice」：服务端未提供时整行不渲染。 */}
        {hasServices ? <DynamicWorkflowModeSetting /> : null}
        <SettingsRow
          label={intl.formatMessage({ id: "settings.modelIoFullRetention" })}
          description={intl.formatMessage({
            id: "settings.modelIoFullRetentionDescription",
          })}
          control={
            <Switch
              aria-label={intl.formatMessage({ id: "settings.modelIoFullRetention" })}
              checked={modelIoFullRetentionEnabled}
              onCheckedChange={(checked) => {
                void onModelIoFullRetentionEnabledChange(checked);
              }}
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.messageStreamShowReasoning" })}
          description={intl.formatMessage({
            id: "settings.messageStreamShowReasoningDescription",
          })}
          control={
            <Switch
              aria-label={intl.formatMessage({ id: "settings.messageStreamShowReasoning" })}
              checked={messageStreamShowReasoning}
              onCheckedChange={(checked) => {
                void onMessageStreamShowReasoningChange(checked);
              }}
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.messageStreamShowTodos" })}
          description={intl.formatMessage({
            id: "settings.messageStreamShowTodosDescription",
          })}
          control={
            <Switch
              aria-label={intl.formatMessage({ id: "settings.messageStreamShowTodos" })}
              checked={messageStreamShowTodos}
              onCheckedChange={(checked) => {
                void onMessageStreamShowTodosChange(checked);
              }}
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.toolGroupingExplore" })}
          description={intl.formatMessage({
            id: "settings.toolGroupingExploreDescription",
          })}
          control={
            <Switch
              aria-label={intl.formatMessage({ id: "settings.toolGroupingExplore" })}
              checked={toolGroupingExploreEnabled}
              onCheckedChange={(checked) => {
                void onToolGroupingExploreEnabledChange(checked);
              }}
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.toolGroupingTerminal" })}
          description={intl.formatMessage({
            id: "settings.toolGroupingTerminalDescription",
          })}
          control={
            <Switch
              aria-label={intl.formatMessage({ id: "settings.toolGroupingTerminal" })}
              checked={toolGroupingTerminalEnabled}
              onCheckedChange={(checked) => {
                void onToolGroupingTerminalEnabledChange(checked);
              }}
            />
          }
        />
        <SettingsRow
          label={intl.formatMessage({ id: "settings.toolGroupingChanges" })}
          description={intl.formatMessage({
            id: "settings.toolGroupingChangesDescription",
          })}
          control={
            <Switch
              aria-label={intl.formatMessage({ id: "settings.toolGroupingChanges" })}
              checked={toolGroupingChangesEnabled}
              onCheckedChange={(checked) => {
                void onToolGroupingChangesEnabledChange(checked);
              }}
            />
          }
        />
      </SettingsGroupCard>

      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.dataBaseDir" })}
          description={intl.formatMessage({
            id: "settings.dataBaseDirDescription",
          })}
          control={
            <DataBaseDirControl
              dataBaseDir={dataBaseDir}
              defaultHomeDir={defaultHomeDir}
              onDataBaseDirChange={onDataBaseDirChange}
              onSelectDataBaseDir={onSelectDataBaseDir}
            />
          }
        />
      </SettingsGroupCard>

      <SettingsGroupCard>
        <SettingsRow
          label={intl.formatMessage({ id: "settings.onboarding" })}
          description={intl.formatMessage({
            id: "settings.onboardingDescription",
          })}
          control={
            <Button type="button" size="lg" variant="outline" onClick={onOpenOnboardingDialog}>
              {intl.formatMessage({ id: "settings.onboardingOpen" })}
            </Button>
          }
        />
      </SettingsGroupCard>
    </div>
  );
}

export function GeneralSectionHeader({ localePreference }: { localePreference: LocalePreference }) {
  const { intl } = useZCodeIntl();

  return (
    <div className="mt-4 flex flex-wrap gap-2">
      <SettingsBadge>
        {intl.formatMessage({ id: `settings.locale.${localePreference}` })}
      </SettingsBadge>
    </div>
  );
}
