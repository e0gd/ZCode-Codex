import { NativeAskUserQuestionInputSchema, type NativeTurnExecutor } from "@zcode/contracts";
import { NativeCodexRpcError, record } from "./connection.js";

type ExecuteInput = Parameters<NativeTurnExecutor["execute"]>[0];
type Answers = Record<string, string>;
const invalidRequestCode = -32600;

export function nativeQuestions(value: unknown, asyncMessage = false) {
  if (!Array.isArray(value) || !value.length) throw new Error("Codex returned invalid user questions.");
  const ids: string[] = [];
  const questions = value.map((raw, index) => {
    const question = record(raw);
    if (question.isSecret === true) throw new Error("Native Codex secret questions are not supported.");
    const id = asyncMessage ? String(index) : question.id;
    if (typeof id !== "string" || !id || id.length > 512 || id.trim() !== id || /\p{Cc}/u.test(id)) throw new Error("Codex returned an invalid question identifier.");
    ids.push(id);
    if (question.options !== null && question.options !== undefined && !Array.isArray(question.options)) throw new Error("Codex returned invalid question options.");
    return {
      question: asyncMessage ? question.title : question.question,
      header: asyncMessage ? `Question ${index + 1}` : question.header,
      options: ((question.options ?? []) as unknown[]).map(rawOption => {
        const option = record(rawOption);
        return asyncMessage ? { label: rawOption, description: "" } : { label: option.label, description: option.description ?? "" };
      }),
      multiSelect: false as const,
    };
  });
  if (new Set(ids).size !== ids.length) throw new Error("Codex returned duplicate question identifiers.");
  return { ids, input: NativeAskUserQuestionInputSchema.parse({ questions, metadata: { source: "native-codex" } }) };
}

type QuestionInput = ReturnType<typeof nativeQuestions>["input"];
interface QuestionDeliveryOptions {
  signal: AbortSignal;
  requestUserInput: ExecuteInput["requestUserInput"];
  serialize: (operation: () => Promise<void>) => Promise<void>;
  startTool: (toolCallId: string, input: QuestionInput) => Promise<void>;
  completeTool: (toolCallId: string, input: QuestionInput, answers: Answers) => Promise<void>;
  currentTurn: () => { threadId: string; turnId: string; completed: boolean };
  request: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  startContinuation: (text: string) => Promise<void>;
  onIdle: () => void;
  onFailure: (error: Error) => void;
}

/** 只持有本次原生执行的投递任务；交互登记、应答幂等与持久化仍由 Core broker 管理。 */
export class NativeQuestionDeliveries {
  private readonly pending = new Set<Promise<void>>();
  private asyncDelivery = Promise.resolve();

  constructor(private readonly options: QuestionDeliveryOptions) {}

  get hasPending(): boolean { return this.pending.size > 0; }

  async open(id: string, toolCallId: string, input: QuestionInput, reply?: (answers: Answers) => void, reject?: () => void): Promise<void> {
    await this.options.startTool(toolCallId, input);
    this.options.signal.throwIfAborted();
    // 用户可能数分钟后才回答；只把已就绪的应答入队，不能占住 native 通知消费链。
    const delivery = this.deliver(id, toolCallId, input, reply);
    this.pending.add(delivery);
    void delivery.then(() => {
      this.pending.delete(delivery);
      void this.options.serialize(async () => { this.options.onIdle(); });
    }, error => {
      this.pending.delete(delivery);
      let failure = error instanceof Error ? error : new Error("Native question delivery failed.");
      try { if (!this.options.signal.aborted) reject?.(); }
      catch { failure = new Error("Native question error response could not be delivered."); }
      this.options.onFailure(failure);
    });
  }

  async settled(): Promise<void> {
    await Promise.allSettled([...this.pending]);
  }

  private async deliver(id: string, toolCallId: string, input: QuestionInput, reply?: (answers: Answers) => void): Promise<void> {
    const answers = await this.options.requestUserInput({ id, toolCallId, questions: input.questions }, { signal: this.options.signal });
    this.options.signal.throwIfAborted();
    // 默认高亮不是提交；仅把 broker 返回且通过原问题 schema 的真实应答写入工具结果。
    NativeAskUserQuestionInputSchema.parse({ ...input, answers });
    await this.options.serialize(async () => {
      this.options.signal.throwIfAborted();
      await this.options.completeTool(toolCallId, input, answers);
      this.options.signal.throwIfAborted();
      reply?.(answers);
    });
    if (reply || !Object.keys(answers).length) return;
    // 只串行已回答的投递，不串行用户等待；前一份 ACK/续轮先确定身份，后一份再取当前轮。
    const delivery = this.asyncDelivery.then(() => this.deliverAsyncAnswer(answers));
    this.asyncDelivery = delivery;
    await delivery;
  }

  private async deliverAsyncAnswer(answers: Answers): Promise<void> {
    let steering: { turnId: string; result: Promise<unknown> } | undefined;
    const text = `User answered the preceding questions:\n${JSON.stringify([answers])}`;
    await this.options.serialize(async () => {
      this.options.signal.throwIfAborted();
      const turn = this.options.currentTurn();
      if (turn.completed) { await this.options.startContinuation(text); return; }
      const result = this.options.request("turn/steer", { threadId: turn.threadId, expectedTurnId: turn.turnId, input: [{ type: "text", text, text_elements: [] }] });
      void result.catch(() => {});
      steering = { turnId: turn.turnId, result };
    });
    if (!steering) return;
    const { turnId, result } = steering;
    try {
      // 等官方 ACK 也不能阻塞 turn/completed，否则无法判断应答与终态的竞态。
      const acknowledged = record(await result);
      if (acknowledged.turnId !== turnId) throw new Error("Codex acknowledged an answer for an unexpected turn.");
    } catch (error) {
      await this.options.serialize(async () => {
        this.options.signal.throwIfAborted();
        const turn = this.options.currentTurn();
        // 只在明确拒绝且已看到同一轮成功终态时改用续轮；断线等不确定结果绝不重发。
        if (error instanceof NativeCodexRpcError && error.method === "turn/steer" && error.rpcCode === invalidRequestCode && turn.turnId === turnId && turn.completed) {
          await this.options.startContinuation(text);
        } else throw error;
      });
    }
  }
}
