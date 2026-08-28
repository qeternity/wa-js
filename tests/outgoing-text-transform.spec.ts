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

import { expect, test } from '@playwright/test';

import {
  classifyOutgoingMediaCaption,
  createOutgoingTextTransformHookInstaller,
  OUTGOING_TEXT_TRANSFORM_BYPASS,
  outgoingHookRetryDelay,
  propagateOutgoingTextTransformBypass,
  setOutgoingTextTransform,
  TRANSFORM_TIMEOUT_MS,
  transformAndSendOutgoingText,
  transformOutgoingText,
  wrapOutgoingMediaPreparation,
} from '../src/chat/outgoingTextTransformCore';

const textContext = Object.freeze({
  kind: 'text' as const,
  chatId: '1@c.us',
  text: 'original',
});

test.afterEach(() => setOutgoingTextTransform(null));

test('transform success, replacement, unregister, and invalid outcomes fail open', async () => {
  setOutgoingTextTransform(() => 'first');
  expect(await transformOutgoingText(textContext)).toBe('first');

  setOutgoingTextTransform(async () => 'replacement');
  expect(await transformOutgoingText(textContext)).toBe('replacement');

  setOutgoingTextTransform(() => undefined);
  expect(await transformOutgoingText(textContext)).toBe('original');
  setOutgoingTextTransform(() => '' as string);
  expect(await transformOutgoingText(textContext)).toBe('original');
  setOutgoingTextTransform(() => 42 as any);
  expect(await transformOutgoingText(textContext)).toBe('original');

  setOutgoingTextTransform(null);
  expect(await transformOutgoingText(textContext)).toBe('original');
});

test('throws, rejections, and timeout preserve the original text', async () => {
  expect(TRANSFORM_TIMEOUT_MS).toBe(150);
  setOutgoingTextTransform(() => {
    throw new Error('sync failure');
  });
  expect(await transformOutgoingText(textContext)).toBe('original');

  setOutgoingTextTransform(() => Promise.reject(new Error('async failure')));
  expect(await transformOutgoingText(textContext)).toBe('original');

  setOutgoingTextTransform(
    () => new Promise((resolve) => setTimeout(() => resolve('late'), 225))
  );
  const started = Date.now();
  expect(await transformOutgoingText(textContext)).toBe('original');
  expect(Date.now() - started).toBeLessThan(200);
});

test('text wrapper invokes native once and preserves native failures', async () => {
  const chat = { id: { toString: () => '1@c.us' } };
  const options = { marker: true };
  let calls = 0;
  setOutgoingTextTransform(() => 'changed');
  expect(
    await transformAndSendOutgoingText(
      (_chat, text, receivedOptions) => {
        calls++;
        expect(receivedOptions).toBe(options);
        return text;
      },
      chat,
      'original',
      options
    )
  ).toBe('changed');
  expect(calls).toBe(1);

  const syncError = new Error('sync native');
  await expect(
    transformAndSendOutgoingText(
      () => {
        calls++;
        throw syncError;
      },
      chat,
      'original',
      options
    )
  ).rejects.toBe(syncError);

  const rejection = new Error('async native');
  await expect(
    transformAndSendOutgoingText(
      () => {
        calls++;
        return Promise.reject(rejection);
      },
      chat,
      'original',
      options
    )
  ).rejects.toBe(rejection);
  expect(calls).toBe(3);
});

test('media wrapper supports both signatures, preserves this, and copies options', async () => {
  setOutgoingTextTransform(({ text }) => `${text}-transformed`);
  const calls: any[] = [];
  const owner = { marker: 'owner' };
  const preparation: any = {
    async sendToChat(this: any, ...args: any[]) {
      calls.push({ args, receiver: this });
      return 'sent';
    },
  };
  wrapOutgoingMediaPreparation(preparation);

  const chat = { id: { toString: () => '1@c.us' } };
  const objectOptions = { caption: 'image', type: 'image' };
  expect(
    await preparation.sendToChat.call(owner, { chat, options: objectOptions })
  ).toBe('sent');
  expect(calls[0].receiver).toBe(owner);
  expect(calls[0].args[0].options.caption).toBe('image-transformed');
  expect(objectOptions.caption).toBe('image');

  const legacyOptions = { caption: 'document', type: 'document' };
  await preparation.sendToChat.call(owner, chat, legacyOptions);
  expect(calls[1].args[0]).toBe(chat);
  expect(calls[1].args[1].caption).toBe('document-transformed');
  expect(legacyOptions.caption).toBe('document');
});

test('media wrapper invokes native exactly once and propagates native failures', async () => {
  setOutgoingTextTransform(() => {
    throw new Error('transform failure');
  });
  const chat = { id: { toString: () => '1@c.us' } };
  const options = { caption: 'caption', type: 'video' };
  const syncError = new Error('native sync');
  let syncCalls = 0;
  const syncPreparation: any = {
    sendToChat() {
      syncCalls++;
      throw syncError;
    },
  };
  wrapOutgoingMediaPreparation(syncPreparation);
  await expect(syncPreparation.sendToChat(chat, options)).rejects.toBe(
    syncError
  );
  expect(syncCalls).toBe(1);

  const rejection = new Error('native rejection');
  let asyncCalls = 0;
  const asyncPreparation: any = {
    sendToChat() {
      asyncCalls++;
      return Promise.reject(rejection);
    },
  };
  wrapOutgoingMediaPreparation(asyncPreparation);
  await expect(asyncPreparation.sendToChat(chat, options)).rejects.toBe(
    rejection
  );
  expect(asyncCalls).toBe(1);
});

test('bypass is consumed without mutating caller options', async () => {
  let transforms = 0;
  setOutgoingTextTransform(() => {
    transforms++;
    return 'changed';
  });
  let nativeOptions: any;
  const preparation: any = {
    sendToChat(_chat: any, options: any) {
      nativeOptions = options;
    },
  };
  wrapOutgoingMediaPreparation(preparation);
  const options: any = {
    caption: 'caption',
    type: 'image',
    [OUTGOING_TEXT_TRANSFORM_BYPASS]: true,
  };
  await preparation.sendToChat({ id: { toString: () => '1@c.us' } }, options);

  expect(transforms).toBe(0);
  expect(nativeOptions.caption).toBe('caption');
  expect(nativeOptions[OUTGOING_TEXT_TRANSFORM_BYPASS]).toBeUndefined();
  expect(options[OUTGOING_TEXT_TRANSFORM_BYPASS]).toBe(true);
});

test('sendFileMessage bypass propagation reaches and is consumed by native media', async () => {
  let transforms = 0;
  setOutgoingTextTransform(() => {
    transforms++;
    return 'changed';
  });
  const callerOptions: any = {
    caption: 'caption',
    type: 'image',
    [OUTGOING_TEXT_TRANSFORM_BYPASS]: true,
  };
  const processedOptions: any = {
    caption: callerOptions.caption,
    type: callerOptions.type,
  };
  propagateOutgoingTextTransformBypass(callerOptions, processedOptions);

  let nativeOptions: any;
  const preparation: any = {
    sendToChat(_chat: any, options: any) {
      nativeOptions = options;
    },
  };
  wrapOutgoingMediaPreparation(preparation);
  await preparation.sendToChat(
    { id: { toString: () => '1@c.us' } },
    processedOptions
  );

  expect(transforms).toBe(0);
  expect(nativeOptions[OUTGOING_TEXT_TRANSFORM_BYPASS]).toBeUndefined();
  expect(processedOptions[OUTGOING_TEXT_TRANSFORM_BYPASS]).toBe(true);
  expect(callerOptions[OUTGOING_TEXT_TRANSFORM_BYPASS]).toBe(true);
});

test('media classification is a strict positive allowlist', () => {
  const chat = { id: { toString: () => '1@g.us' } };
  for (const type of ['image', 'video', 'document'] as const) {
    expect(
      classifyOutgoingMediaCaption(chat, { caption: 'caption', type })
    ).toEqual({
      chatId: '1@g.us',
      mediaType: type,
      text: 'caption',
    });
  }

  const rejected = [
    [
      { id: { toString: () => 'status@broadcast' } },
      { caption: 'x', type: 'image' },
    ],
    [chat, { caption: 'x', type: 'image', isViewOnce: true }],
    [chat, { caption: 'x', type: 'image', multicast: true }],
    [chat, { caption: 'x', type: 'image', albumId: 'album' }],
    [chat, { caption: 'x', type: 'image', productId: 'product' }],
    [
      chat,
      {
        caption: 'x',
        type: 'image',
        productMsgOptions: { productId: 'product' },
      },
    ],
    [
      chat,
      {
        caption: undefined,
        type: 'image',
        productMsgOptions: { filename: 'file.jpg' },
      },
    ],
    [chat, { caption: 'x', type: 'product' }],
    [chat, { caption: 'x', type: 'album' }],
    [chat, { caption: 'x', type: 'unknown' }],
  ];
  for (const [candidateChat, options] of rejected) {
    expect(classifyOutgoingMediaCaption(candidateChat, options)).toBeNull();
  }

  expect(
    classifyOutgoingMediaCaption(chat, {
      caption: 'ordinary',
      type: 'image',
      productMsgOptions: { filename: 'ordinary.jpg' },
    })
  ).not.toBeNull();
});

test('hook retry schedule caps and media wrapping is idempotent', () => {
  expect(
    Array.from({ length: 8 }, (_, index) => outgoingHookRetryDelay(index))
  ).toEqual([100, 200, 400, 800, 1600, 2000, 2000, 2000]);

  let calls = 0;
  const preparation: any = {
    sendToChat() {
      calls++;
    },
  };
  expect(wrapOutgoingMediaPreparation(preparation)).toBe(true);
  const wrapped = preparation.sendToChat;
  expect(wrapOutgoingMediaPreparation(preparation)).toBe(true);
  expect(preparation.sendToChat).toBe(wrapped);

  const incompatible: any = {};
  Object.defineProperty(incompatible, 'sendToChat', {
    value() {},
    writable: false,
  });
  expect(wrapOutgoingMediaPreparation(incompatible)).toBe(false);
  expect(calls).toBe(0);
});

test('installer hooks native text and media modules independently and idempotently', async () => {
  const calls: string[] = [];
  const module: any = {
    sendText(_chat: any, text: string) {
      calls.push(`text:${text}`);
      return text;
    },
    prep() {
      return {
        sendToChat(_chat: any, options: any) {
          calls.push(`media:${options.caption}`);
          return options.caption;
        },
      };
    },
  };
  const wrapCounts = new Map<any, number>();
  const installer = createOutgoingTextTransformHookInstaller({
    getSendTextMsgToChat: () => module.sendText,
    getPrepRawMedia: () => module.prep,
    tryWrapModuleFunction(func, callback) {
      const name = module.sendText === func ? 'sendText' : 'prep';
      wrapCounts.set(func, (wrapCounts.get(func) || 0) + 1);
      module[name] = (...args: any[]) => callback(func, ...args);
      return true;
    },
    schedule: () => undefined,
    warn: () => undefined,
  });
  setOutgoingTextTransform(({ text }) => `${text}-transformed`);

  installer.installAll();
  installer.installAll();
  const chat = { id: { toString: () => '1@c.us' } };
  await module.sendText(chat, 'hello', {});
  const preparation = module.prep();
  await preparation.sendToChat(chat, { caption: 'photo', type: 'image' });

  expect(calls).toEqual(['text:hello-transformed', 'media:photo-transformed']);
  expect([...wrapCounts.values()]).toEqual([1, 1]);
});

test('installer retries missing hooks and disables failures independently', () => {
  const scheduled: Array<{ callback: () => void; delay: number }> = [];
  const warnings: string[] = [];
  let text: any = undefined;
  const media = () => ({ sendToChat() {} });
  const installer = createOutgoingTextTransformHookInstaller({
    getSendTextMsgToChat: () => text,
    getPrepRawMedia: () => media,
    tryWrapModuleFunction(func) {
      return func === text;
    },
    schedule(callback, delay) {
      scheduled.push({ callback, delay });
    },
    warn(message) {
      warnings.push(message);
    },
  });

  installer.installAll();
  expect(scheduled.map(({ delay }) => delay)).toEqual([100]);
  expect(warnings).toEqual(['outgoing media transform hook unavailable']);

  text = () => undefined;
  scheduled[0].callback();
  expect(warnings).toHaveLength(1);
});
