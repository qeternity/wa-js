/*!
 * Copyright 2021 WPPConnect Team
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

import { getMyUserWid } from '../../conn/functions/getMyUserWid';
import { WPPError } from '../../util';
import { websocket } from '../../whatsapp';
import { getVoipStackInterface } from '../../whatsapp/functions';
import { getCall, isActiveCall, isIncomingCall } from './getCall';

export interface CallRejectOptions {
  /**
   * Force sending the reject stanza, skipping state validation and E2E session setup.
   */
  force?: boolean;
}

/**
 * Reject a incoming call
 *
 * @example
 * ```javascript
 * // Reject any incoming call
 * WPP.call.reject();
 *
 * // Reject specific call id
 * WPP.call.reject(callId);
 *
 * // Force reject specific call id
 * WPP.call.reject(callId, { force: true });
 *
 * // Reject any incoming call
 * WPP.on('call.incoming_call', (call) => {
 *   WPP.call.reject(call.id);
 * });
 * ```
 *
 * @param   {string}  callId  The call ID, empty to reject the first one
 * @return  {[type]}          [return description]
 */
export async function reject(
  callId?: string,
  options: CallRejectOptions | boolean = {}
): Promise<boolean> {
  const force = typeof options === 'boolean' ? options : !!options.force;
  const call = getCall(callId);

  if (!call) {
    throw new WPPError(
      'call_not_found',
      `Call ${callId || '<empty>'} not found`,
      {
        callId,
      }
    );
  }

  if (!force && !isIncomingCall(call) && !call.isGroup) {
    throw new WPPError(
      'call_is_not_incoming_ring',
      `Call ${callId || '<empty>'} is not incoming ring`,
      {
        callId,
        state: call.getState(),
      }
    );
  }

  /**
   * Native VoIP stack (WhatsApp >= 2.3000): same path used by the reject
   * button in `useWAWebVoipCallHandlers`. It has no call id argument, so it is
   * only usable for the active call.
   */
  if (
    !force &&
    isActiveCall(call) &&
    typeof getVoipStackInterface === 'function'
  ) {
    const voipStack = await getVoipStackInterface();

    if (typeof voipStack?.rejectCall === 'function') {
      // Marks the call as declined instead of missed on the call log
      (call as any).userEndedCall = true;

      await voipStack.rejectCall();

      return true;
    }
  }

  /**
   * Legacy path, for WhatsApp versions without the native VoIP stack
   *
   * TODO: remove when 2.3000.10xx is no longer available in wa-version/html
   */
  if (!force && !call.peerJid.isGroupCall()) {
    await websocket.ensureE2ESessions([call.peerJid]);
  }

  const node = websocket.smax(
    'call',
    {
      from: getMyUserWid().toString({ legacy: true }),
      to: call.peerJid.toString({ legacy: true }),
      id: websocket.generateId(),
    },
    [
      websocket.smax(
        'reject',
        {
          'call-id': call.id,
          'call-creator': call.peerJid.toString({ legacy: true }),
          count: '0',
        },
        null
      ),
    ]
  );

  await websocket.sendSmaxStanza(node);

  return true;
}
