import type { TFunction } from 'i18next';
import { OTHER_PRODUCT, type Product } from '../shared/types';
import type { Bootstrap } from './api';
import { loc } from './i18n';

/** What a request asks for, in words. A request for something else has no catalogue product: the buyer's note says what. */
export function requestedAs(boot: Bootstrap, productId: string, t: TFunction): { product?: Product; name: string; unit: string } {
  const product = boot.products.find((p) => p.id === productId);
  if (product) return { product, name: loc(product.name), unit: t(`units.${product.unit}`) };
  return { name: t('somethingElse'), unit: t('unitsOther') };
}

export const isOther = (productId: string) => productId === OTHER_PRODUCT;
