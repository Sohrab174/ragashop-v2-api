import { SetMetadata } from '@nestjs/common';
import { UserCapabilityName } from './capability.catalog';

export const CAPABILITIES_KEY = 'capabilities';

export const RequireCapabilities = (...capabilities: UserCapabilityName[]) =>
  SetMetadata(CAPABILITIES_KEY, capabilities);
