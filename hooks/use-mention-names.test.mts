import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync("hooks/use-mention-names.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;

const moduleShim = { exports: {} };
vm.runInNewContext(
  `${compiled}\nmodule.exports.__mentionSubscriberTest = {
    subscribeToCacheKeys,
    notifyCacheKeys,
    subscriberCountForKey: (key) => subscribersByCacheKey.get(key)?.size || 0,
    subscribedKeyCount: () => subscribersByCacheKey.size,
  };`,
  {
    module: moduleShim,
    exports: moduleShim.exports,
    require: (specifier: string) => {
      if (specifier === "react") {
        return { useEffect() {}, useMemo() {}, useState() {} };
      }
      if (specifier === "@/contexts/AuthContext") {
        return { useAuth() {} };
      }
      if (specifier === "@/lib/api/whatsapp") {
        return { whatsappAPI: {} };
      }
      throw new Error(`Import inesperado no teste: ${specifier}`);
    },
  },
);

const registry = (moduleShim.exports as {
  __mentionSubscriberTest: {
    subscribeToCacheKeys(keys: readonly string[], subscriber: () => void): () => void;
    notifyCacheKeys(keys: readonly string[]): void;
    subscriberCountForKey(key: string): number;
    subscribedKeyCount(): number;
  };
}).__mentionSubscriberTest;

test("lista sem menções não cria assinatura", () => {
  let notifications = 0;
  const unsubscribe = registry.subscribeToCacheKeys([], () => {
    notifications += 1;
  });

  assert.equal(registry.subscribedKeyCount(), 0);
  registry.notifyCacheKeys(["org:global:any:5511999999999"]);
  assert.equal(notifications, 0);
  unsubscribe();
});

test("notificação alcança somente assinantes das menções alteradas", () => {
  let firstNotifications = 0;
  let secondNotifications = 0;
  const firstKey = "org:global:any:5511111111111";
  const secondKey = "org:global:any:5522222222222";
  const unsubscribeFirst = registry.subscribeToCacheKeys([firstKey], () => {
    firstNotifications += 1;
  });
  const unsubscribeSecond = registry.subscribeToCacheKeys([secondKey], () => {
    secondNotifications += 1;
  });

  registry.notifyCacheKeys([firstKey]);

  assert.equal(firstNotifications, 1);
  assert.equal(secondNotifications, 0);
  unsubscribeFirst();
  unsubscribeSecond();
});

test("lote com chaves repetidas provoca uma única atualização por componente", () => {
  let notifications = 0;
  const firstKey = "org:global:any:5533333333333";
  const secondKey = "org:global:any:5544444444444";
  const unsubscribe = registry.subscribeToCacheKeys(
    [firstKey, firstKey, secondKey],
    () => {
      notifications += 1;
    },
  );

  assert.equal(registry.subscriberCountForKey(firstKey), 1);
  assert.equal(registry.subscriberCountForKey(secondKey), 1);
  registry.notifyCacheKeys([firstKey, firstKey, secondKey]);
  assert.equal(notifications, 1);

  unsubscribe();
  assert.equal(registry.subscriberCountForKey(firstKey), 0);
  assert.equal(registry.subscriberCountForKey(secondKey), 0);
  assert.equal(registry.subscribedKeyCount(), 0);
});

test("hook pula a assinatura quando não há chave e publica apenas o lote alterado", () => {
  assert.match(source, /if \(subscriptionKeys\.length === 0\) return;/);
  assert.match(source, /notifyCacheKeys\(changedKeys\.filter/);
  assert.doesNotMatch(source, /subscribers\.forEach\(\(cb\) => cb\(\)\)/);
});
