import { getRepository, LessThan, MoreThan } from 'typeorm';

export enum SortAction {
  up = 'up',
  down = 'down',
}

export const sort = async (repository, id, action: SortAction) => {
  const original: any = await getRepository(repository).findOne({
    where: { id },
    select: ['id', 'displayOrder'],
  });

  let alternate = null;

  if (action === 'up') {
    alternate = await getRepository(repository).findOne({
      where: { displayOrder: LessThan(original.displayOrder) },
      order: { displayOrder: 'DESC' },
      select: ['id', 'displayOrder'],
    });
  } else {
    alternate = await getRepository(repository).findOne({
      where: { displayOrder: MoreThan(original.displayOrder) },
      order: { displayOrder: 'ASC' },
      select: ['id', 'displayOrder'],
    });
  }

  if (!alternate) {
    return false;
  }

  const tempDisplayOrder = original.displayOrder;

  original.displayOrder = alternate.displayOrder;
  await original.save();

  alternate.displayOrder = tempDisplayOrder;
  await alternate.save();

  return true;
};
