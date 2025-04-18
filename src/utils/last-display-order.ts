import { getRepository } from 'typeorm';

export const getLastDisplayOrder = async (repository, where = null) => {
  const lastAttribute: any = await getRepository(repository).findOne({
    ...(where && { where }),
    select: ['displayOrder'],
    order: { displayOrder: 'DESC' },
  });

  if (!lastAttribute) {
    return 1;
  }
  return +lastAttribute.displayOrder + 1;
};
