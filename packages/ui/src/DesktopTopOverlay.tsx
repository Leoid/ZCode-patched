import { useEffect, useState } from "react";
import type { IPlatformService, UpdateStatePayload } from "@zcode/shared";
import { cn } from "@/components/lib/utils.js";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  Bug,
  MessageCirclePlus,
  PanelLeftClose,
  PanelLeftOpen,
} from "lucide-react";
import researchModeGifUrl from "@/assets/research-mode/shigure.gif";
import { useLatestDecodeTps } from "@/store/latestDecodeStore.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { UpdateStatusButton } from "@/UpdateStatusButton.js";
import { DesktopTopOverlayActionButton } from "@/DesktopTopOverlayActionButton.js";
import {
  createWindowsCaptionControlsStyle,
  WINDOWS_CAPTION_CONTROLS_RIGHT_INSET_VAR,
} from "@/windowCaptionControls.js";

const RESEARCH_MODE_STORAGE_KEY = "zcode.researchModeEnabled";

interface DesktopTopOverlayProps {
  workspaceAbsPath: string;
  /** 当前激活的 task；Bug Hunting Mode 用它读取最近一轮的解码速率。 */
  activeTaskId?: string | null;
  isMacDesktop?: boolean;
  isMacFullscreen?: boolean;
  isWindowsDesktop?: boolean;
  isDesktop?: boolean;
  macWindowControlsLeftPaddingPx?: number;
  windowsWindowControlsRightPaddingPx?: number;
  isSidebarVisible: boolean;
  updateReadyVersion: string | null;
  updateState: UpdateStatePayload | null;
  toggleSidebarShortcutLabel: string;
  newTaskShortcutLabel: string;
  goBackShortcutLabel: string;
  goForwardShortcutLabel: string;
  canTaskNavBack: boolean;
  canTaskNavForward: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  showNewTaskButton?: boolean;
  appLogoUrl: string;
  platform: IPlatformService;
  onToggleSidebar: () => void;
  onCreateTask: () => void;
  onGoBack: () => void;
  onGoForward: () => void;
  hideTaskNavigationButtons?: boolean;
  newTaskDisabledReason?: string;
}

export function DesktopTopOverlay({
  activeTaskId,
  isMacDesktop,
  isMacFullscreen,
  isWindowsDesktop,
  isDesktop,
  macWindowControlsLeftPaddingPx,
  windowsWindowControlsRightPaddingPx,
  isSidebarVisible,
  updateReadyVersion,
  updateState,
  toggleSidebarShortcutLabel,
  newTaskShortcutLabel,
  goBackShortcutLabel,
  goForwardShortcutLabel,
  canTaskNavBack,
  canTaskNavForward,
  canGoBack: _canGoBack,
  canGoForward: _canGoForward,
  showNewTaskButton,
  appLogoUrl,
  platform,
  onToggleSidebar,
  onCreateTask,
  onGoBack,
  onGoForward,
  hideTaskNavigationButtons = false,
  newTaskDisabledReason,
}: DesktopTopOverlayProps) {
  const { intl } = useZCodeIntl();
  // Bug Hunting Mode 是本地实验开关，不参与服务端状态；沿用 localStorage 保证窗口重开后保持不变。
  const [bugHuntingEnabled, setBugHuntingEnabled] = useState<boolean>(() => {
    try {
      return window.localStorage.getItem(RESEARCH_MODE_STORAGE_KEY) === "1";
    } catch {
      return false;
    }
  });
  // 装饰图在左右两侧随机切换，避免固定在一角遮挡同一块内容。
  const [gifSide, setGifSide] = useState<"left" | "right">(() =>
    Math.random() < 0.5 ? "left" : "right",
  );
  const toggleBugHunting = () => {
    setBugHuntingEnabled((enabled) => {
      const next = !enabled;
      try {
        window.localStorage.setItem(RESEARCH_MODE_STORAGE_KEY, next ? "1" : "0");
      } catch {
        // localStorage 不可用时（隐私模式）只影响持久化，不影响本次开关。
      }
      return next;
    });
  };
  useEffect(() => {
    if (!bugHuntingEnabled) {
      return;
    }
    let timer: number;
    const scheduleSwap = () => {
      timer = window.setTimeout(
        () => {
          setGifSide((side) => (side === "left" ? "right" : "left"));
          scheduleSwap();
        },
        6000 + Math.random() * 6000,
      );
    };
    scheduleSwap();
    return () => window.clearTimeout(timer);
  }, [bugHuntingEnabled]);
  // Bug 修复：解码速率改取会话内唯一真源（computeGenerationSpeed，以 runtime 实测 firstTokenAt
  // 计窗），不再用 session-debug 的 tokensPerSecond——后者在响应被缓冲为末尾一次性到达时解码窗口
  // 塌缩到几毫秒，会把速率放大成两万+ 的假值（曾显示 "21360 tok/s decode"）。
  const latestDecodeTps = useLatestDecodeTps(activeTaskId ?? null);
  const SidebarToggleIcon = isSidebarVisible ? PanelLeftClose : PanelLeftOpen;
  const isLinuxDesktop = Boolean(isDesktop && !isMacDesktop && !isWindowsDesktop);
  const usesCustomCaptionArea = isWindowsDesktop || isLinuxDesktop;
  const toggleSidebarTitle = intl.formatMessage({
    id: "workspaceSidebar.toggleSidebar",
  });
  const newTaskTitle = intl.formatMessage({ id: "sidebar.newTask" });
  const taskBackTitle = intl.formatMessage({ id: "taskNav.back" });
  const taskForwardTitle = intl.formatMessage({ id: "taskNav.forward" });
  const isNewTaskButtonVisible = showNewTaskButton ?? !isSidebarVisible;
  const macTopOverlayPaddingStyle =
    isMacDesktop && !isMacFullscreen && Number.isFinite(macWindowControlsLeftPaddingPx)
      ? { paddingLeft: `${Math.round(macWindowControlsLeftPaddingPx ?? 96)}px` }
      : undefined;
  const windowsTopOverlayPaddingStyle = isWindowsDesktop
    ? {
        ...createWindowsCaptionControlsStyle(windowsWindowControlsRightPaddingPx),
        paddingRight: WINDOWS_CAPTION_CONTROLS_RIGHT_INSET_VAR,
      }
    : undefined;
  const topOverlayWidthStyle = isSidebarVisible
    ? { width: "var(--workspace-sidebar-panel-width)" }
    : undefined;

  return (
    <div
      style={topOverlayWidthStyle}
      className={cn(
        "@container/topoverlayer pointer-events-none absolute h-14 flex left-0 top-0 z-20 w-fit",
        // Windows/Linux 主面板新增 4px 留白及 1px 边框，左侧工具组需同步偏移才能对齐 Header 中心线。
        usesCustomCaptionArea && "top-1 mt-px",
      )}
    >
      <div
        style={{
          ...macTopOverlayPaddingStyle,
          ...windowsTopOverlayPaddingStyle,
        }}
        className={cn(
          "flex items-center",
          isMacDesktop && "h-14",
          usesCustomCaptionArea && "h-12",
          // Windows/Linux 工具组计入 4px 外沿留白和 1px 边框，较 8px 左边距右移 5px。
          usesCustomCaptionArea && "pl-3 ml-px",
          isMacDesktop &&
            (isMacFullscreen ? (!isSidebarVisible ? "pl-5 pt-1" : "pl-3 pt-1") : "pt-1"),
        )}
      >
        <div
          className={cn(
            // 顶部浮层按钮虽然单个按钮打了 no-drag，但外层容器本身仍悬在窗口标题区上方。
            // Electron 在这类覆盖层上会优先按父级命中拖拽区域，导致点击被窗口拖动吞掉。
            // 这里把整块交互容器一起标成 no-drag，确保展开/收起和新建 task 都能稳定点击。
            "pointer-events-auto flex items-center gap-1 shrink-0 [app-region:no-drag]",
          )}
        >
          {usesCustomCaptionArea && (
            <DesktopTopOverlayActionButton
              title={toggleSidebarTitle}
              shortcut={toggleSidebarShortcutLabel}
              ariaLabel={toggleSidebarTitle}
              buttonClassName="group relative overflow-hidden rounded-lg"
              onClick={onToggleSidebar}
            >
              <img
                src={appLogoUrl}
                alt="ZCode"
                className="size-5 transition-opacity duration-150 group-hover:opacity-0"
                draggable={false}
              />
              <SidebarToggleIcon className="absolute inset-0 m-auto size-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
            </DesktopTopOverlayActionButton>
          )}

          {isMacDesktop && (
            <DesktopTopOverlayActionButton
              title={toggleSidebarTitle}
              shortcut={toggleSidebarShortcutLabel}
              ariaLabel={toggleSidebarTitle}
              onClick={onToggleSidebar}
            >
              <SidebarToggleIcon className="size-4" />
            </DesktopTopOverlayActionButton>
          )}

          <button
            type="button"
            role="switch"
            aria-checked={bugHuntingEnabled}
            aria-label="Bug Hunting Mode"
            onClick={toggleBugHunting}
            className={cn(
              "[app-region:no-drag] group inline-flex h-7 shrink-0 items-center gap-2 rounded-full pl-1 pr-2.5 text-xs font-semibold tracking-tight outline-none transition-all duration-300",
              "focus-visible:ring-2 focus-visible:ring-lime-400/70 focus-visible:ring-offset-1 focus-visible:ring-offset-background",
              bugHuntingEnabled
                ? "bg-accent text-foreground shadow-sm ring-1 ring-lime-500/45"
                : "text-muted-foreground hover:bg-accent/70 hover:text-accent-foreground",
            )}
          >
            <span
              aria-hidden
              className={cn(
                "relative flex h-5 w-9 items-center rounded-full transition-colors duration-300",
                bugHuntingEnabled ? "bg-lime-500" : "bg-muted-foreground/30",
              )}
            >
              <span
                aria-hidden
                className={cn(
                  "absolute size-4 rounded-full bg-white shadow-sm transition-transform duration-300 ease-out",
                  bugHuntingEnabled ? "translate-x-[1.125rem]" : "translate-x-0.5",
                )}
              />
            </span>
            <Bug
              aria-hidden
              className={cn(
                "size-3.5 transition-transform duration-300",
                bugHuntingEnabled ? "-rotate-12 scale-110" : "rotate-0",
              )}
            />
            <span>Bug Hunting Mode</span>
          </button>

          {/* 远程控制移动端左上角空间有限，任务前进/后退在这里会与主操作拥挤重叠。*/}
          {hideTaskNavigationButtons ? null : (
            <>
              <DesktopTopOverlayActionButton
                title={taskBackTitle}
                shortcut={goBackShortcutLabel}
                ariaLabel={taskBackTitle}
                testId="desktop-top-nav-back"
                disabled={!canTaskNavBack}
                onClick={onGoBack}
              >
                <ArrowLeftIcon className="size-4" />
              </DesktopTopOverlayActionButton>
              <DesktopTopOverlayActionButton
                title={taskForwardTitle}
                shortcut={goForwardShortcutLabel}
                ariaLabel={taskForwardTitle}
                disabled={!canTaskNavForward}
                onClick={onGoForward}
              >
                <ArrowRightIcon className="size-4" />
              </DesktopTopOverlayActionButton>
            </>
          )}

          <div
            aria-hidden={!isNewTaskButtonVisible}
            className={cn(
              "inline-flex overflow-hidden transition-[opacity,width] duration-300 ease-out",
              isNewTaskButtonVisible ? "w-7 opacity-100" : "pointer-events-none w-0 opacity-0",
            )}
          >
            <DesktopTopOverlayActionButton
              title={newTaskDisabledReason ?? newTaskTitle}
              shortcut={newTaskShortcutLabel}
              ariaLabel={newTaskTitle}
              disabled={Boolean(newTaskDisabledReason)}
              onClick={onCreateTask}
            >
              <MessageCirclePlus className="size-4" />
            </DesktopTopOverlayActionButton>
          </div>

          {/* <div className="flex items-center [app-region:no-drag]"> */}
          {/* 侧栏收起后，更新按钮之前会跟着“展开态的容器宽度阈值”一起被隐藏。
                  但收起态本身已经改成把操作集中到顶部浮层里，如果这里还继续依赖侧栏宽度判断，
                  用户就会在最需要全局入口的时候反而看不到更新按钮。
                  所以展开态继续走容器查询，收起态则强制显示。 */}
          <UpdateStatusButton
            platform={platform}
            version={updateReadyVersion}
            updateState={updateState}
            isMacDesktop={isMacDesktop}
            isWindowsDesktop={isWindowsDesktop}
          />
          {/* </div> */}
        </div>
      </div>

      {/* Bug Hunting Mode 开启时在左右两角随机展示装饰动图与最新解码速率；整块不接收指针事件。 */}
      {bugHuntingEnabled && (
        <div
          className={cn(
            "pointer-events-none fixed bottom-64 z-30 flex select-none flex-col items-center gap-2 transition-[left,right] duration-500 ease-out",
            gifSide === "left" && !isSidebarVisible && "left-4",
            gifSide === "right" && "right-4",
          )}
          style={
            gifSide === "left" && isSidebarVisible
              ? { left: "calc(var(--workspace-sidebar-panel-width, 0px) + 1rem)" }
              : undefined
          }
        >
          {/* 动图自带白色底，用混合模式让边缘融进页面，避免出现白色方框。 */}
          <img
            src={researchModeGifUrl}
            alt=""
            draggable={false}
            className="size-80 object-contain mix-blend-multiply dark:mix-blend-screen"
          />
          <div className="flex flex-col items-center rounded-2xl bg-background/75 px-3 py-1.5 leading-none backdrop-blur-sm">
            <span className="text-3xl font-bold tabular-nums tracking-tight text-foreground">
              {latestDecodeTps === null ? "--" : latestDecodeTps.toFixed(0)}
            </span>
            <span className="mt-1 text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              tok/s decode
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
