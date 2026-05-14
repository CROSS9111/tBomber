import Player from '@server/rooms/schema/Player';

export function getWinner(data: any): Player | undefined {
  for (let i = 0; i < data.length; i++) {
    if (data[i].field === 'winner') return data[i].value;
  }

  return undefined;
}
