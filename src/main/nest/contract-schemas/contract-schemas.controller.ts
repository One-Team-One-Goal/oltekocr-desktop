import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { ContractSchemasService } from "./contract-schemas.service";
import {
  CreateContractSchemaDto,
  UpdateContractSchemaDto,
} from "./contract-schemas.dto";

@ApiTags("contract-schemas")
@Controller("contract-schemas")
export class ContractSchemasController {
  constructor(private readonly schemasService: ContractSchemasService) {}

  @Post()
  @ApiOperation({ summary: "Create a contract extraction schema" })
  create(@Body() dto: CreateContractSchemaDto) {
    return this.schemasService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: "List contract extraction schemas" })
  findAll(
    @Query("documentType") documentType?: string,
    @Query("active") active?: string,
  ) {
    const activeFilter =
      active === undefined ? undefined : String(active).toLowerCase() === "true";
    return this.schemasService.findAll(documentType, activeFilter);
  }

  @Get("active/:documentType")
  @ApiOperation({ summary: "Get active schema for a document type" })
  findActive(@Param("documentType") documentType: string) {
    return this.schemasService.findActive(documentType);
  }

  @Get(":id")
  @ApiOperation({ summary: "Get a schema by ID" })
  findOne(@Param("id") id: string) {
    return this.schemasService.findOne(id);
  }

  @Patch(":id")
  @ApiOperation({ summary: "Update a schema" })
  update(@Param("id") id: string, @Body() dto: UpdateContractSchemaDto) {
    return this.schemasService.update(id, dto);
  }

  @Post(":id/activate")
  @ApiOperation({ summary: "Activate a schema (deactivates others of same document type)" })
  activate(@Param("id") id: string) {
    return this.schemasService.activate(id);
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a schema" })
  remove(@Param("id") id: string) {
    return this.schemasService.remove(id);
  }
}
