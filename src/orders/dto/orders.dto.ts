import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum PackageSize {
  Small = 'Small',
  Medium = 'Medium',
  Large = 'Large',
}

export enum PackageType {
  General = 'General',
  Documents = 'Documents',
  Food = 'Food',
  Fragile = 'Fragile',
}

export enum VehicleType {
  Car = 'Car',
  Van = 'Van',
}

class ContactDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  phone!: string;
}

class AddressDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  formatted!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  street?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  city!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  postalCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  country?: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(2)
  countryCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  placeId?: string;

  @IsOptional()
  @IsNumber()
  @Min(-90)
  lat?: number;

  @IsOptional()
  @IsNumber()
  @Min(-180)
  lng?: number;
}

export class CreateOrderDto {
  @ValidateNested()
  @Type(() => AddressDto)
  pickup!: AddressDto;

  @ValidateNested()
  @Type(() => AddressDto)
  dropoff!: AddressDto;

  @ValidateNested()
  @Type(() => ContactDto)
  pickupContact!: ContactDto;

  @ValidateNested()
  @Type(() => ContactDto)
  dropoffContact!: ContactDto;

  @IsOptional()
  @ValidateNested()
  @Type(() => ContactDto)
  customer?: ContactDto;

  @IsString()
  @IsNotEmpty()
  @MinLength(5)
  @MaxLength(500)
  itemDescription!: string;

  @IsUrl({ require_protocol: true })
  @MaxLength(2000)
  receiptUrl!: string;

  @IsOptional()
  @IsEnum(PackageSize)
  packageSize?: PackageSize;

  @IsOptional()
  @IsEnum(PackageType)
  packageType?: PackageType;

  @IsOptional()
  @IsEnum(VehicleType)
  vehicleType?: VehicleType;

  @IsOptional()
  @IsBoolean()
  fragile?: boolean;

  @IsOptional()
  @IsBoolean()
  requiresSignature?: boolean;

  @IsOptional()
  @IsBoolean()
  contactless?: boolean;

  @IsOptional()
  @IsBoolean()
  returnToShop?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @IsOptional()
  @IsString()
  scheduledAt?: string;
}

export class AcceptBidDto {
  @IsString()
  @IsNotEmpty()
  @IsUrl({ require_protocol: true })
  returnUrl!: string;
}

export class FinalizeBidDto {
  @IsString()
  @IsNotEmpty()
  sessionId!: string;
}
