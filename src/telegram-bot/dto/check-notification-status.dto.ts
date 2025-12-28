import { IsString, IsOptional } from 'class-validator';

export class CheckNotificationStatusDto {
  @IsString()
  initData: string;

  @IsOptional()
  @IsString()
  groupName?: string;
}
