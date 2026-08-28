/*!
 * Copyright 2026 WPPConnect Team
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export type OutgoingTextTransformContext =
  | Readonly<{ kind: 'text'; chatId: string; text: string }>
  | Readonly<{
      kind: 'media_caption';
      chatId: string;
      text: string;
      hasExplicitCaption: boolean;
      mediaType: 'image' | 'video' | 'document';
    }>;

export type OutgoingTextTransform = (
  context: OutgoingTextTransformContext
) => string | undefined | Promise<string | undefined>;

export const OUTGOING_TEXT_TRANSFORM_BYPASS = Symbol(
  'OUTGOING_TEXT_TRANSFORM_BYPASS'
);
export const TRANSFORM_TIMEOUT_MS = 150;
export const OUTGOING_HOOK_RETRY_DELAYS = [
  100, 200, 400, 800, 1600, 2000,
] as const;

const wrappedMediaPreparations = new WeakSet<object>();
let outgoingTextTransform: OutgoingTextTransform | null = null;

export function setOutgoingTextTransform(
  transform: OutgoingTextTransform | null
): void {
  outgoingTextTransform = typeof transform === 'function' ? transform : null;
}

export async function transformOutgoingText(
  context: OutgoingTextTransformContext
): Promise<string> {
  const original = context.text;
  const transform = outgoingTextTransform;
  if (!transform) return original;

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(() => transform(Object.freeze({ ...context }))),
      new Promise<undefined>((resolve) => {
        timer = setTimeout(() => resolve(undefined), TRANSFORM_TIMEOUT_MS);
      }),
    ]);
    return typeof result === 'string' && result.length > 0 ? result : original;
  } catch {
    return original;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export function outgoingTextChatId(chat: any): string | null {
  const value = chat?.id?.toString?.();
  return typeof value === 'string' && value && value !== '[object Object]'
    ? value
    : null;
}

export async function transformAndSendOutgoingText(
  nativeSend: (chat: any, text: any, options: any) => any,
  chat: any,
  text: any,
  options: any
) {
  const chatId = outgoingTextChatId(chat);
  const transformed =
    chatId && typeof text === 'string' && text.length > 0
      ? await transformOutgoingText(
          Object.freeze({ kind: 'text', chatId, text })
        )
      : text;
  return nativeSend(chat, transformed, options);
}

export function outgoingHookRetryDelay(attempt: number): number {
  const index = Math.max(0, Math.floor(attempt));
  return OUTGOING_HOOK_RETRY_DELAYS[
    Math.min(index, OUTGOING_HOOK_RETRY_DELAYS.length - 1)
  ];
}

export function propagateOutgoingTextTransformBypass(
  source: any,
  target: any
): void {
  if (source?.[OUTGOING_TEXT_TRANSFORM_BYPASS] === true) {
    target[OUTGOING_TEXT_TRANSFORM_BYPASS] = true;
  }
}

function hasTruthyMarker(value: any, names: string[]): boolean {
  if (!value || typeof value !== 'object') return false;
  return names.some((name) => value[name] != null && value[name] !== false);
}

export function classifyOutgoingMediaCaption(chat: any, options: any) {
  const chatId = outgoingTextChatId(chat);
  if (!chatId || chatId === 'status@broadcast') return null;
  if (!options || typeof options !== 'object') return null;
  if (!['image', 'video', 'document'].includes(options.type)) return null;
  if (options.isViewOnce === true || options.multicast) return null;

  const excludedMarkers = [
    'albumId',
    'isAlbum',
    'isAlbumMessage',
    'mediaAlbum',
    'productId',
    'productImageCount',
    'productListItemCount',
  ];
  if (
    hasTruthyMarker(options, excludedMarkers) ||
    hasTruthyMarker(options.productMsgOptions, excludedMarkers)
  ) {
    return null;
  }

  const text = typeof options.caption === 'string' ? options.caption : '';
  return {
    chatId,
    hasExplicitCaption: text.trim().length > 0,
    mediaType: options.type as 'image' | 'video' | 'document',
    text,
  };
}

export function splitOutgoingMediaArguments(args: any[]) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object') {
    return {
      chat: args[0].chat,
      options: args[0].options,
      rebuild(options: any) {
        return [{ ...args[0], options }];
      },
    };
  }
  return {
    chat: args[0],
    options: args[1],
    rebuild(options: any) {
      return [args[0], options, ...args.slice(2)];
    },
  };
}

export function wrapOutgoingMediaPreparation(preparation: any): boolean {
  if (!preparation || typeof preparation !== 'object') return false;
  if (wrappedMediaPreparations.has(preparation)) return true;

  const original = preparation.sendToChat;
  const descriptor = Object.getOwnPropertyDescriptor(preparation, 'sendToChat');
  if (
    typeof original !== 'function' ||
    (descriptor && descriptor.writable === false && !descriptor.set)
  ) {
    return false;
  }

  const wrapped = async function (this: any, ...args: any[]) {
    const parsed = splitOutgoingMediaArguments(args);
    let options = parsed.options;
    const bypass = options?.[OUTGOING_TEXT_TRANSFORM_BYPASS] === true;
    const hasBypassMarker =
      options &&
      typeof options === 'object' &&
      Object.prototype.hasOwnProperty.call(
        options,
        OUTGOING_TEXT_TRANSFORM_BYPASS
      );

    if (hasBypassMarker) {
      options = { ...options };
      delete options[OUTGOING_TEXT_TRANSFORM_BYPASS];
    }

    const caption = bypass
      ? null
      : classifyOutgoingMediaCaption(parsed.chat, options);
    if (caption) {
      const text = await transformOutgoingText(
        Object.freeze({ kind: 'media_caption' as const, ...caption })
      );
      if (text !== caption.text) options = { ...options, caption: text };
    }

    return original.apply(this, parsed.rebuild(options));
  };

  try {
    preparation.sendToChat = wrapped;
  } catch {
    return false;
  }
  if (preparation.sendToChat !== wrapped) return false;
  wrappedMediaPreparations.add(preparation);
  return true;
}

type HookKind = 'text' | 'media';

export type OutgoingTextTransformHookDependencies = {
  getSendTextMsgToChat: () => any;
  getPrepRawMedia: () => any;
  tryWrapModuleFunction: (func: any, callback: any) => boolean;
  schedule: (callback: () => void, delay: number) => any;
  warn: (message: string) => void;
};

export function createOutgoingTextTransformHookInstaller(
  dependencies: OutgoingTextTransformHookDependencies
) {
  const states: Record<HookKind, 'pending' | 'installed' | 'disabled'> = {
    text: 'pending',
    media: 'pending',
  };
  const retries: Record<HookKind, number> = { text: 0, media: 0 };
  let mediaPreparationShapeDisabled = false;

  function disableHook(kind: HookKind): void {
    if (states[kind] === 'disabled') return;
    states[kind] = 'disabled';
    dependencies.warn(`outgoing ${kind} transform hook unavailable`);
  }

  function wrapPreparationOrDisable(preparation: any): void {
    if (mediaPreparationShapeDisabled) return;
    if (!wrapOutgoingMediaPreparation(preparation)) {
      mediaPreparationShapeDisabled = true;
      disableHook('media');
    }
  }

  function scheduleRetry(kind: HookKind): void {
    const delay = outgoingHookRetryDelay(retries[kind]++);
    dependencies.schedule(() => install(kind), delay);
  }

  function install(kind: HookKind): void {
    try {
      installUnchecked(kind);
    } catch {
      disableHook(kind);
    }
  }

  function installUnchecked(kind: HookKind): void {
    if (states[kind] !== 'pending') return;

    if (kind === 'text') {
      const nativeTextSend = dependencies.getSendTextMsgToChat();
      if (nativeTextSend == null) return scheduleRetry(kind);
      if (typeof nativeTextSend !== 'function') return disableHook(kind);

      const installed = dependencies.tryWrapModuleFunction(
        nativeTextSend,
        (nativeSend: any, chat: any, text: any, options: any) =>
          transformAndSendOutgoingText(nativeSend, chat, text, options)
      );
      if (!installed) return disableHook(kind);
      states[kind] = 'installed';
      return;
    }

    const nativePrepRawMedia = dependencies.getPrepRawMedia();
    if (nativePrepRawMedia == null) return scheduleRetry(kind);
    if (typeof nativePrepRawMedia !== 'function') return disableHook(kind);

    const installed = dependencies.tryWrapModuleFunction(
      nativePrepRawMedia,
      (nativePrep: any, ...args: any[]) => {
        const preparation = nativePrep(...args);
        if (preparation && typeof preparation.then === 'function') {
          void Promise.resolve(preparation).then(
            wrapPreparationOrDisable,
            () => undefined
          );
        } else {
          wrapPreparationOrDisable(preparation);
        }
        return preparation;
      }
    );
    if (!installed) return disableHook(kind);
    states[kind] = 'installed';
  }

  return {
    install(kind: HookKind): void {
      install(kind);
    },
    installAll(): void {
      install('text');
      install('media');
    },
  };
}
