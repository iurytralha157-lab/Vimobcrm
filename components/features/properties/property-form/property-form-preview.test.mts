import assert from "node:assert/strict";
import test from "node:test";
import { initialFormData } from "@/components/features/properties/property-form/property-form-model";
import { buildPropertyFormPublicPreview } from "@/components/features/properties/property-form/property-form-preview";

test("prévia usa somente descrição pública e exclui informações privadas", () => {
  const preview = buildPropertyFormPublicPreview({
    ...initialFormData,
    title: "Casa",
    descricao_site: "Descrição comercial",
    descricao: "Anotação interna secreta",
    owner_email: "proprietario@example.test",
    numero_matricula: "MATRICULA-PRIVADA",
    comentarios_internos: "Comentário privado",
  });
  assert.equal(preview.description, "Descrição comercial");
  const serialized = JSON.stringify(preview);
  for (const privateValue of ["Anotação interna secreta", "proprietario@example.test", "MATRICULA-PRIVADA", "Comentário privado"]) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test("prévia aplica cada nível de endereço e falha fechada para nível desconhecido", () => {
  const formData = { ...initialFormData, endereco: "Rua A", numero: "15", bairro: "Centro", cidade: "Cidade", uf: "SP", cep: "12345-678" };
  assert.equal(buildPropertyFormPublicPreview({ ...formData, public_address_visibility: "completo" }).address, "Rua A, 15, Centro, Cidade, SP, 12345-678");
  assert.equal(buildPropertyFormPublicPreview({ ...formData, public_address_visibility: "parcial" }).address, "Centro, Cidade, SP");
  for (const visibility of ["minimo", "", "unknown"]) {
    assert.equal(buildPropertyFormPublicPreview({ ...formData, public_address_visibility: visibility }).address, "Cidade, SP");
  }
});

test("prévia exclui fotos internas inclusive a capa e preserva ordem pública sem repetição", () => {
  const preview = buildPropertyFormPublicPreview({
    ...initialFormData,
    imagem_principal: "blob:private",
    fotos: ["blob:private", "blob:public", "blob:public", "blob:second"],
    hidden_site_image_urls: ["blob:private"],
  });
  assert.deepEqual(preview.images, ["blob:public", "blob:second"]);
});
