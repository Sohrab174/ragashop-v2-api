import { SetMetadata } from '@nestjs/common';
import { UserCapabilityName } from '../../manual-payment/manual-payment.types';

export const CAPABILITIES_KEY = 'capabilities';

export const RequireCapabilities = (...capabilities: UserCapabilityName[]) =>
  SetMetadata(CAPABILITIES_KEY, capabilities);
