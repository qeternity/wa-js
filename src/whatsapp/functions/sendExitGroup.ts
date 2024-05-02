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

import { ChatModel } from '..';
import { exportModule } from '../exportModule';

/** @whatsapp 5501
 * @whatsapp 605501 >= 2.2222.8
 * @whatsapp 525510 >= 2.2228.4
 */
export declare function sendExitGroup(group: ChatModel): Promise<void>;

exportModule(
  exports,
  {
    sendExitGroup: 'sendExitGroup',
  },
  (m) => m.sendExitGroup
);
