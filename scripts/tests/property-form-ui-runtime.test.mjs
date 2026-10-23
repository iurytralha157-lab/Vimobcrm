import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const require = createRequire(import.meta.url);
// Bound the native Tailwind scanner pool in this synthetic fixture process.
process.env.RAYON_NUM_THREADS ||= "1";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const sectionNames = ["Owner", "Structure", "Location", "Values", "Characteristics", "Extras", "Media", "Publication", "Commissions", "Confidential"];
const steps = [
  ["owner", "Proprietário", "User"], ["structure", "Dados do imóvel", "Home"],
  ["location", "Localização", "MapPin"], ["values", "Valores", "DollarSign"],
  ["characteristics", "Características", "Settings2"], ["extras", "Extras", "Tag"],
  ["media", "Mídia e descrições", "Image"], ["publication", "Publicação", "Globe"],
  ["commissions", "Comissões", "Percent"], ["confidential", "Confidencial", "Lock"],
];
let temporaryDirectory;
let browser;
let page;
const browserErrors = [];
const measurements = [];

// Real property sections, Radix controls, preview and shared wizard. Data and
// outer application/auth shells are inert; no API/backend is started or called.
function buildFixture(formClass, wizardClass) {
  return `
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { User, Home, MapPin, DollarSign, Settings2, Tag, Image, Globe, Percent, Lock, ChevronLeft, ChevronRight, Save } from "lucide-react";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { PropertyFormDialog } from "@/components/features/properties/property-form/PropertyFormDialog";
import { PropertyFormAside } from "@/components/features/properties/property-form/PropertyFormAside";
import { PropertyFormSectionsProvider } from "@/components/features/properties/property-form/PropertyFormSectionsContext";
import { initialFormData } from "@/components/features/properties/property-form/property-form-model";
import { getStagedPropertyPhoto } from "@/lib/property-media-draft";
import { FormWizardLayout } from "@/components/shared/forms/FormWizardLayout";
import { FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME, FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME } from "@/config/form-wizard";
${sectionNames.map(name => `import { ${name}Section } from "@/components/features/properties/property-form/sections/${name}Section";`).join("\n")}
const Icons = { User, Home, MapPin, DollarSign, Settings2, Tag, Image, Globe, Percent, Lock, ChevronLeft, ChevronRight, Save };
const steps = ${JSON.stringify(steps)}.map(([id, label, icon]) => ({ id, label, icon: Icons[icon], buttonId: "property-tab-"+id, panelId: "property-panel-"+id }));
const noop = () => {};
const mutation = { isPending: false, mutateAsync: async () => { throw new Error("Mutations forbidden in visual fixture"); } };
function Fixture() {
  const [activeTab, setActiveTab] = useState("owner");
  const [busy, setBusy] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [asideProperty, setAsideProperty] = useState(null);
  const [formData, setFormData] = useState({ ...initialFormData, title: "Apartamento sintético com vista para o parque", tipo_de_imovel: "Apartamento", finalidade: "Residencial", tipo_de_negocio: "Venda e Locação", cidade: "Cidade Sintética", bairro: "Bairro Sintético", uf: "SC", owner_name: "Proprietário sintético", quartos: "3", suites: "1", banheiros: "2", vagas: "2", area_util: "98.5", preco: "850000.50", valor_locacao: "3500", descricao_site: "Descrição comercial sintética para verificar legibilidade e dimensões do formulário." });
  window.propertyFixture = { activeTab, formData, busy, preparing, setBusy, setPreparing, setAsideProperty, getStagedPropertyPhoto, set: (key, value) => setFormData(current => ({...current,[key]:value})) };
  const context = {
    formData, set: (key,value) => { if (!busy) setFormData(current => ({...current,[key]:value})); },
    user: { id: "synthetic-user" }, profile: { full_name: "Usuário sintético" }, users: [{ id: "synthetic-user", name: "Usuário sintético" }],
    property: null, propertyId: null, isEditing: false, isSaving: busy, router: {push:noop}, activeOrganizationId: "synthetic-org",
    canManagePropertyCatalogs: true, canAssignProperty: true, canEditOwnerDetails: true, applyOwner: noop, handleCreateOwner: noop, createPropertyOwner: mutation,
    displayedPurposeOptions: ["Residencial", "Comercial"], displayedDealOptions: ["Venda", "Locação", "Venda e Locação"], statusOptions: [{ value:"ativo",label:"Ativo" }], propertyTypes: ["Apartamento", "Casa"],
    newPurposeName:"", setNewPurposeName:noop, newTypeName:"", setNewTypeName:noop, showAddPurpose:false,setShowAddPurpose:noop,showAddType:false,setShowAddType:noop,handleAddPurpose:noop,handleAddPropertyType:noop,handleDealTypeChange:value=>setFormData(current=>({...current,tipo_de_negocio:value})),createPropertyType:mutation,
    cities:[],neighborhoods:[],condominiums:[],applyCity:noop,applyNeighborhood:noop,applyCondominium:noop,lookupCep:noop,isCepLoading:false,
    newCityName:"",setNewCityName:noop,newCityUf:"SC",setNewCityUf:noop,newNeighborhoodName:"",setNewNeighborhoodName:noop,newCondominiumName:"",setNewCondominiumName:noop,newCondominiumFee:"",setNewCondominiumFee:noop,newCondominiumPhoto:"",setNewCondominiumPhoto:noop,newCondominiumHasConcierge:false,setNewCondominiumHasConcierge:noop,newCondominiumConciergeType:"",setNewCondominiumConciergeType:noop,
    showAddCity:false,setShowAddCity:noop,showAddNeighborhood:false,setShowAddNeighborhood:noop,showAddCondominium:false,setShowAddCondominium:noop,handleCreateCity:noop,handleCreateNeighborhood:noop,handleCreateCondominium:noop,createCity:mutation,createNeighborhood:mutation,createCondominium:mutation,
    isLand:false,isSale:true,isRental:true,supportsRentalContractTerms:true,supportsSaleTerms:true,primaryValuesGridClass:"",features:[],proximities:[],loadingFeatures:false,loadingProximities:false,createFeature:mutation,createProximity:mutation,
    handleImagesChange:(fotos,imagem_principal)=>{window.fixturePhotosChangesCount=(window.fixturePhotosChangesCount||0)+1;setFormData(current=>({...current,fotos,imagem_principal}));},onPreparingPhotosChange:value=>{(window.photoPreparationEvents ||= []).push(value);setPreparing(value);},canContinuePhotos:()=>window.fixturePhotoScopeAllowed!==false,isPreparingPhotos:preparing,
  };
  const index = steps.findIndex(step=>step.id===activeTab);
  const openHistory = () => { window.historyOpenCalls = (window.historyOpenCalls || 0) + 1; };
  return <PropertyFormDialog title="Novo Imóvel" busy={busy} onClose={noop}><form onSubmit={event=>event.preventDefault()} className=${JSON.stringify(formClass)}>
    <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
      <FormWizardLayout className=${JSON.stringify(wizardClass)} steps={steps} activeStep={activeTab} onStepChange={setActiveTab} contentClassName="@container space-y-4" asideTitle={asideProperty?"Histórico do imóvel":"Prévia pública"} aside={<PropertyFormAside property={asideProperty} formData={formData} onOpenHistory={openHistory}/>} footer={<>
        <Button type="button" variant="ghost" className={FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME} disabled={busy}>Cancelar</Button>
        <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="ghost" className={FORM_WIZARD_SECONDARY_BUTTON_CLASS_NAME} disabled={busy||index===0} onClick={()=>setActiveTab(steps[index-1].id)}><Icons.ChevronLeft className="mr-1 h-4 w-4"/>Voltar</Button>
          {index<steps.length-1&&<Button type="button" className={FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME} disabled={busy} onClick={()=>setActiveTab(steps[index+1].id)}>Avançar<Icons.ChevronRight className="ml-1 h-4 w-4"/></Button>}
          <Button type="submit" data-tour="property-save-button" className={FORM_WIZARD_PRIMARY_BUTTON_CLASS_NAME} disabled={busy||preparing}><Icons.Save className="mr-2 h-4 w-4"/>Cadastrar</Button>
        </div>
      </>}>
      <PropertyFormSectionsProvider value={context}>${sectionNames.map(name=>`<${name}Section/>`).join("")}</PropertyFormSectionsProvider>
      <details className="app-card-soft p-3 sm:hidden"><summary className="cursor-pointer text-[12px] font-normal">{asideProperty?"Histórico do imóvel":"Prévia pública"}</summary><div className="mt-3"><PropertyFormAside property={asideProperty} formData={formData} onOpenHistory={openHistory}/></div></details>
      </FormWizardLayout>
    </Tabs>
  </form></PropertyFormDialog>;
}
createRoot(document.getElementById("app")).render(<Fixture/>);
`;
}

before(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "vimob-property-form-ui-"));
  const loader = path.join(temporaryDirectory, "typescript-loader.cjs");
  const cssLoader = path.join(temporaryDirectory, "css-loader.cjs");
  const entry = path.join(temporaryDirectory, "fixture.tsx");
  const stubs = path.join(temporaryDirectory, "inert-shells.tsx");
  const nextImage = path.join(temporaryDirectory, "next-image.tsx");
  const nextLink = path.join(temporaryDirectory, "next-link.tsx");
  const mainSource = await readFile(path.join(root, "components/features/properties/PropertyFormScreen.tsx"), "utf8");
  const formClass = mainSource.match(/className="(property-form-surface[^\"]*)"/)?.[1];
  assert.ok(formClass, "Fixture must use the current property form classes");
  const wizardClass = mainSource.match(/<FormWizardLayout\s+className="([^\"]+)"/)?.[1] || "";
  await writeFile(entry, buildFixture(formClass, wizardClass));
  await writeFile(loader, `const ts=require(${JSON.stringify(path.join(root,"node_modules/typescript"))});module.exports=function(source){return ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2020}}).outputText;};`);
  await writeFile(cssLoader, `module.exports=function(source){const css=source.replace(/:global\\(([^)]+)\\)/g,'$1').replace(/\\.surface\\b/g,'.propertyFixtureSurface');return 'const style=document.createElement("style");style.textContent='+JSON.stringify(css)+';document.head.append(style);export default {surface:"propertyFixtureSurface"};';};`);
  await writeFile(stubs, `import React from "react";export const AppLayout=({children})=><div>{children}</div>;export const ProductUpdatesDialog=()=>null;export const PropertyAssetManager=()=>null;export const PropertyOwnerCombobox=()=> <button type="button" role="combobox" className="flex h-10 w-full min-w-0 items-center rounded-md border px-3">Selecionar proprietário</button>;export const DEFAULT_FEATURES=["Sala de jantar","Cozinha","Escritório","Lavanderia","Despensa","Lavabo","Área de churrasco","Jardim","Piscina","Varanda","Sacada","Closet","Home office","Sala de estar","Quintal","Edícula"];export const DEFAULT_PROXIMITIES=["Escolas","Universidades","Hospitais","Farmácias","Supermercados","Shoppings","Bancos","Transporte público","Metrô / Trem","Restaurantes","Padarias","Postos de gasolina","Academia","Parques"];`);
  await writeFile(nextImage, `import React from "react";export default function Image({fill,unoptimized,priority,sizes,style,...props}){return <img {...props} style={{...(fill?{position:"absolute",inset:0,width:"100%",height:"100%"}:{}),...style}}/>;}`);
  await writeFile(nextLink, `import React from "react";export default function Link(props){return <a {...props}/>;}`);
  const aliases = Object.fromEntries(["components/shared/layout/AppLayout","components/features/news","components/features/properties/PropertyOwnerCombobox","components/features/properties/detail/PropertyAssetManager","hooks/use-property-features","hooks/use-property-proximities"].map(name=>[`@/${name}$`,stubs]));
  const { webpack } = require("next/dist/compiled/webpack/webpack");
  await new Promise((resolve,reject)=>{
    const compiler=webpack({mode:"development",target:"web",devtool:false,entry,output:{path:temporaryDirectory,filename:"fixture.js"},resolve:{extensions:[".tsx",".ts",".js"],alias:{...aliases,"next/image$":nextImage,"next/link$":nextLink,"@":root},modules:[path.join(root,"node_modules"),"node_modules"]},module:{rules:[{test:/\.tsx?$/,exclude:/node_modules/,use:loader},{test:/\.module\.css$/,use:cssLoader}]},optimization:{minimize:false,usedExports:true}});
    compiler.run((error,stats)=>compiler.close(()=>error||stats?.hasErrors()?reject(error||new Error(stats.toString({all:false,errors:true}))):resolve()));
  });
  if(process.env.PROPERTY_UI_SCREENSHOT_DIR) console.log("Property fixture: compiled actual components");
  const cssSources=["components/features/properties","components/shared/forms/FormWizardLayout.tsx","components/ui","config/form-wizard.ts",entry.replaceAll("\\","/")];
  const productCss=(await readFile(path.join(root,"app/globals.css"),"utf8")).replace('@import "tailwindcss";','@import "tailwindcss" source(none);');
  const css=await require("postcss")([require("@tailwindcss/postcss")({base:root})]).process(`${productCss}\n${cssSources.map(source=>`@source "${path.isAbsolute(source)?source:path.join(root,source).replaceAll("\\","/")}";`).join("\n")}`,{from:path.join(root,"app/property-form-fixture.css")});
  if(process.env.PROPERTY_UI_SCREENSHOT_DIR) console.log("Property fixture: compiled actual CSS");
  browser=await chromium.launch({headless:true});
  page=await browser.newPage({viewport:{width:390,height:844},hasTouch:true,timezoneId:"America/Sao_Paulo"});
  page.on("pageerror",error=>browserErrors.push(error.message));
  await page.route("**/*",route=>route.request().url()==="http://property-form-fixture.local/"?route.fulfill({contentType:"text/html",body:`<style>${css.css}</style><div id="app"></div>`}):route.abort());
  await page.goto("http://property-form-fixture.local/");
  await page.addScriptTag({content:await readFile(path.join(temporaryDirectory,"fixture.js"),"utf8")});
  await page.getByRole("dialog").waitFor();
});

after(async () => {
  await browser?.close();
  if (process.env.PROPERTY_UI_SCREENSHOT_DIR) console.log(JSON.stringify({measurements,browserErrors}));
  if (temporaryDirectory) {
    const resolved = path.resolve(temporaryDirectory);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith("vimob-property-form-ui-"));
    await rm(resolved,{recursive:true,force:true});
  }
});

for (const viewport of [{width:320,height:844},{width:390,height:844},{width:1280,height:800}]) {
  test(`ten real sections fit ${viewport.width}×${viewport.height} without horizontal field overflow`,async()=>{
    await page.setViewportSize(viewport);
    for (const [id] of steps) {
      await page.getByRole("tab",{name:steps.find(step=>step[0]===id)[1],exact:true}).click();
      const panel=page.locator(`#property-panel-${id}`);
      await panel.waitFor({state:"visible"});
      const metrics=await page.evaluate(()=>{
        const content=document.querySelector("[data-form-wizard-content]");
        const dialog=document.querySelector('[role="dialog"]');
        const panel=content.querySelector('[data-state="active"]');
        const controls=[...panel.querySelectorAll('input:not([type="file"]):not([aria-hidden="true"]),textarea,button[role="combobox"]')].filter(element=>element.getBoundingClientRect().width>0);
        const outside=controls.filter(element=>{const box=element.getBoundingClientRect();const bounds=content.getBoundingClientRect();return box.right>bounds.right+1||box.left<bounds.left-1;}).map(element=>element.id||element.outerHTML.slice(0,100));
        const footer=document.querySelector('[data-tour="property-save-button"]').closest('[data-form-wizard]').lastElementChild;
        const footerBox=footer.getBoundingClientRect();
        const footerOutside=[...footer.querySelectorAll('button')].filter(element=>{const box=element.getBoundingClientRect();return box.width>0&&(box.right>innerWidth+1||box.left<0||box.bottom>innerHeight+1);}).map(element=>element.textContent.trim());
        const contentBox=content.getBoundingClientRect();
        return {contentWidth:content.clientWidth,scrollWidth:content.scrollWidth,dialogWidth:dialog.getBoundingClientRect().width,outside,footerOutside,fontSizes:controls.map(element=>parseFloat(getComputedStyle(element).fontSize)),footerBottom:footerBox.bottom,contentHeight:contentBox.height,navHeight:document.querySelector('[aria-label="Etapas do formulário"]').getBoundingClientRect().height,availableScrollHeight:content.parentElement.clientHeight};
      });
      measurements.push({viewport,id,...metrics});
      assert.ok(metrics.scrollWidth<=metrics.contentWidth+1,`${id}: content ${metrics.scrollWidth}>${metrics.contentWidth}`);
      assert.deepEqual(metrics.outside,[],`${id}: field bounds`);
      assert.deepEqual(metrics.footerOutside,[],`${id}: footer button bounds`);
      assert.ok(metrics.dialogWidth<=viewport.width,`${id}: dialog exceeds viewport`);
      assert.ok(metrics.footerBottom<=viewport.height+1,`${id}: footer clipped`);
      if(viewport.width<768) assert.ok(metrics.fontSizes.every(size=>size>=16),`${id}: mobile controls below16px`);
      if(viewport.width<640) {
        assert.ok(metrics.navHeight<=60,`${id}: mobile navigation uses multiple rows`);
        assert.ok(metrics.contentHeight>=400,`${id}: mobile fields have too little usable height`);
      }
    }
    assert.deepEqual(browserErrors,[]);
    if(process.env.PROPERTY_UI_SCREENSHOT_DIR) {
      await page.getByRole("tab",{name:"Valores",exact:true}).click();
      await page.screenshot({path:path.join(process.env.PROPERTY_UI_SCREENSHOT_DIR,`properties-${viewport.width}-values.png`)});
      await page.getByRole("tab",{name:"Mídia e descrições",exact:true}).click();
      await page.screenshot({path:path.join(process.env.PROPERTY_UI_SCREENSHOT_DIR,`properties-${viewport.width}-media.png`)});
    }
  });
}

test("saving freezes every real section control and blocks closing with Escape",async()=>{
  await page.evaluate(()=>window.propertyFixture.setBusy(true));
  for(const [id,label] of steps){
    await page.getByRole("tab",{name:label,exact:true}).click();
    const count=await page.locator(`#property-panel-${id}`).evaluate(panel=>[...panel.querySelectorAll('input,textarea,button,select')].filter(element=>element.getBoundingClientRect().width>0&&!element.matches(':disabled')).length);
    assert.equal(count,0,`${id}: enabled control while saving`);
  }
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(),1);
  await page.evaluate(()=>window.propertyFixture.setBusy(false));
});

test("actual browser JPEG preparation stages a bounded photo and releases save lock",async()=>{
  await page.getByRole("tab",{name:"Mídia e descrições",exact:true}).click();
  const bytes=await page.evaluate(async()=>{
    const canvas=document.createElement("canvas");canvas.width=3000;canvas.height=1500;
    const context=canvas.getContext("2d");context.fillStyle="#a04020";context.fillRect(0,0,canvas.width,canvas.height);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,"image/jpeg",0.95));
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  await page.locator('#property-panel-media input[type="file"]').first().setInputFiles({name:"synthetic-large.jpg",mimeType:"image/jpeg",buffer:Buffer.from(bytes)});
  await page.waitForFunction(()=>Boolean(window.propertyFixture.formData.imagem_principal)&&!window.propertyFixture.preparing);
  const staged=await page.evaluate(async()=>{
    const selected=window.propertyFixture.getStagedPropertyPhoto(window.propertyFixture.formData.imagem_principal);
    const bitmap=await createImageBitmap(selected.file);
    const result={type:selected.file.type,size:selected.file.size,width:bitmap.width,height:bitmap.height,events:window.photoPreparationEvents};bitmap.close();return result;
  });
  assert.equal(staged.type,"image/jpeg");
  assert.ok(staged.width<=2048&&staged.height<=2048);
  assert.ok(staged.size<=2*1024*1024);
  assert.deepEqual(staged.events,[true,false]);
  assert.equal(await page.locator('[data-tour="property-save-button"]').isDisabled(),false);
  assert.deepEqual(browserErrors,[]);
});

test("mobile disclosure keeps actual public preview and saved history accessible",async()=>{
  await page.setViewportSize({width:390,height:844});
  await page.getByRole("tab",{name:"Publicação",exact:true}).click();
  const disclosure=page.locator("details");
  await disclosure.locator("summary").click();
  await disclosure.getByTestId("property-form-public-preview").waitFor({state:"visible"});
  await disclosure.getByRole("button",{name:"Desktop",exact:true}).click();
  assert.equal(await disclosure.getByRole("button",{name:"Desktop",exact:true}).getAttribute("aria-pressed"),"true");
  await page.evaluate(()=>window.propertyFixture.setAsideProperty({title:"Imóvel sintético salvo",code:"SYN-001",updated_at:"2026-10-12T10:00:00Z"}));
  await disclosure.getByTestId("property-form-history").waitFor({state:"visible"});
  assert.ok((await disclosure.textContent()).includes("SYN-001"));
  await disclosure.getByRole("button",{name:"Ver histórico completo"}).click();
  assert.equal(await page.evaluate(()=>window.historyOpenCalls),1);
  await disclosure.locator("summary").click();
  assert.equal(await disclosure.evaluate(element=>element.open),false);
  assert.deepEqual(browserErrors,[]);
});

for (const scopeContinues of [true, false]) test(`photo preparation after step navigation ${scopeContinues?"keeps both gallery files":"rejects changed form scope"}`,async()=>{
  await page.evaluate(()=>{
    window.fixturePhotoScopeAllowed=true;
    window.fixturePhotosChangesCount=0;
    window.propertyFixture.set('fotos',[]);window.propertyFixture.set('imagem_principal','');
  });
  await page.getByRole('tab',{name:'Mídia e descrições',exact:true}).click();
  const bytes=await page.evaluate(async()=>{
    const canvas=document.createElement('canvas');canvas.width=100;canvas.height=50;
    canvas.getContext('2d').fillRect(0,0,100,50);
    const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg'));
    const original=window.createImageBitmap;
    const originalEncode=HTMLCanvasElement.prototype.toBlob;
    window.photoEncodeCount=0;
    HTMLCanvasElement.prototype.toBlob=function(callback,...args){return originalEncode.call(this,blob=>{callback(blob);window.photoEncodeCount+=1;},...args);};
    let release;const gate=new Promise(resolve=>release=resolve);let calls=0;
    window.restorePhotoDecoder=()=>{window.createImageBitmap=original;HTMLCanvasElement.prototype.toBlob=originalEncode;};window.releasePhotoDecode=release;
    window.createImageBitmap=async(...args)=>{const image=await original(...args);calls+=1;if(calls===2){window.photoDecodeHeld=true;await gate;}return image;};
    window.photoDecodeHeld=false;
    return [...new Uint8Array(await blob.arrayBuffer())];
  });
  const file={name:'synthetic-gallery.jpg',mimeType:'image/jpeg',buffer:Buffer.from(bytes)};
  await page.locator('#property-panel-media input[type="file"][multiple]').setInputFiles([file,{...file,name:'synthetic-gallery-2.jpg'}]);
  await page.waitForFunction(()=>window.photoDecodeHeld);
  await page.getByRole('tab',{name:'Localização',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#property-panel-media input[type="file"]')===null);
  await page.getByRole('tab',{name:'Mídia e descrições',exact:true}).click();
  assert.equal(await page.locator('#property-panel-media input[type="file"]').evaluateAll(inputs=>inputs.every(input=>input.disabled)),true);
  await page.getByRole('tab',{name:'Localização',exact:true}).click();
  await page.evaluate(value=>{window.fixturePhotoScopeAllowed=value;window.releasePhotoDecode();},scopeContinues);
  if(scopeContinues){
    await page.waitForFunction(()=>window.propertyFixture.formData.fotos.length===1&&!window.propertyFixture.preparing);
    assert.equal(await page.evaluate(()=>[window.propertyFixture.formData.imagem_principal,...window.propertyFixture.formData.fotos].every(url=>Boolean(window.propertyFixture.getStagedPropertyPhoto(url)))),true);
  }else{
    await page.waitForFunction(()=>window.photoEncodeCount===2);
    assert.equal(await page.evaluate(()=>window.fixturePhotosChangesCount),0);
    assert.equal(await page.evaluate(()=>window.propertyFixture.formData.fotos.length),0);
  }
  await page.evaluate(()=>{window.restorePhotoDecoder();window.fixturePhotoScopeAllowed=true;window.propertyFixture.setPreparing(false);});
  assert.deepEqual(browserErrors,[]);
});
