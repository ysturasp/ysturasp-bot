import {
  IsString,
  IsNumber,
  IsBoolean,
  IsOptional,
  IsArray,
  Min,
} from 'class-validator';

export class ToggleNotificationDto {
  @IsString()
  initData: string;

  @IsString()
  groupName: string;

  @IsNumber()
  @Min(0)
  notifyMinutes: number;

  @IsOptional()
  @IsArray()
  hiddenSubjects?: any[];

  @IsOptional()
  @IsBoolean()
  excludeHidden?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  manuallyExcludedSubjects?: string[];

  @IsOptional()
  @IsBoolean()
  update?: boolean;
}
