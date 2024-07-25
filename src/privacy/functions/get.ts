/*!
 * Copyright 2024 WPPConnect Team
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

/**
 * Get all privacy settings
 *
 * @example
 * ```javascript
 * Set value for who can see your online status like 'all'
 * await WPP.privacy.get();
 * ```
 *
 * @category Privacy
 */

import { getUserPrivacySettings } from '../../whatsapp/functions';

export function get(): {
  about: string;
  callAdd: string;
  groupAdd: string;
  lastSeen: string;
  online: string;
  profilePicture: string;
  readReceipts: string;
} {
  return getUserPrivacySettings();
}
