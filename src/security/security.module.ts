import { Module } from '@nestjs/common';
import { AuthRateLimitGuard } from './auth-rate-limit.guard';
import { AuthRateLimitService } from './auth-rate-limit.service';

@Module({
  providers: [AuthRateLimitService, AuthRateLimitGuard],
  exports: [AuthRateLimitService, AuthRateLimitGuard],
})
export class SecurityModule {}
