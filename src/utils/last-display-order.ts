import { getRepository } from 'typeorm';

export const getLastDisplayOrder = async (repository) => {
  const lastAttribute: any = await getRepository(repository).findOne({
    select: ['displayOrder'],
    order: { displayOrder: 'DESC' },
  });

  if (!lastAttribute) {
    return 1;
  }
  return +lastAttribute.displayOrder + 1;
};
