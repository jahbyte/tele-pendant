import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class SavePlcConnectionDto {
  @ApiProperty({ example: 'plant-plc' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  label!: string;

  @ApiProperty({ example: '192.168.1.50' })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  host!: string;

  @ApiProperty({ example: 502 })
  @IsInt()
  @Min(1)
  @Max(65535)
  port!: number;

  @ApiProperty({ example: 1 })
  @IsInt()
  @Min(0)
  @Max(255)
  unitId!: number;

  @ApiProperty({
    example: true,
    description: 'When true, this row is the PLC the API connects to',
  })
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({
    example: 'modbus-tcp',
    enum: ['modbus-tcp', 'modbus-tls', 'opcua'],
  })
  @IsOptional()
  @IsIn(['modbus-tcp', 'modbus-tls', 'opcua'])
  protocol?: 'modbus-tcp' | 'modbus-tls' | 'opcua';

  @ApiPropertyOptional({ description: 'CA / trust PEM path' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  tlsCaPath?: string | null;

  @ApiPropertyOptional({ description: 'Client certificate PEM path' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  tlsCertPath?: string | null;

  @ApiPropertyOptional({ description: 'Client private key PEM path' })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  tlsKeyPath?: string | null;

  @ApiPropertyOptional({
    example: true,
    description: 'Verify peer certificate (TLS / OPC UA)',
  })
  @IsOptional()
  @IsBoolean()
  tlsRejectUnauthorized?: boolean;

  @ApiPropertyOptional({
    enum: ['None', 'Sign', 'SignAndEncrypt'],
    example: 'SignAndEncrypt',
  })
  @IsOptional()
  @IsIn(['None', 'Sign', 'SignAndEncrypt'])
  opcSecurityMode?: 'None' | 'Sign' | 'SignAndEncrypt' | null;

  @ApiPropertyOptional({ example: 'Basic256Sha256' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  opcSecurityPolicy?: string | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(120)
  opcUsername?: string | null;

  @ApiPropertyOptional({
    description: 'Path to a file containing the OPC UA password',
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  opcPasswordFile?: string | null;
}
