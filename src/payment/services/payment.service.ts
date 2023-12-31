import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CreatePaymentDto } from '../dto';
import { preferences } from '../preferences';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PaymentService {
  constructor(
    private configService: ConfigService,
    private prismaService: PrismaService,
  ) {} // Injecting dependecies

  async createPayment(dto: CreatePaymentDto, uid: number) {
    try {
      const response = await fetch(
        `${this.configService.get(
          'MERCADOPAGO_API_BASE_URL',
        )}/checkout/preferences`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.configService.get(
              'MERCADOPAGO_ACCESS_TOKEN',
            )}`,
          },
          body: JSON.stringify({
            ...dto,
            ...preferences,
            metadata: {
              uid,
            },
          }),
        },
      );

      const { init_point } = await response.json();

      return init_point;
    } catch (error) {
      throw new InternalServerErrorException('Internal Server Error');
    }
  }

  async createOrderAfterPayment(paymentId: number) {
    try {
      const response = await fetch(
        `${this.configService.get(
          'MERCADOPAGO_API_BASE_URL',
        )}/v1/payments/${paymentId}`,
        {
          headers: {
            Authorization: `Bearer ${this.configService.get(
              'MERCADOPAGO_ACCESS_TOKEN',
            )}`,
          },
        },
      );

      const { additional_info, transaction_amount, metadata } =
        await response.json();
      const items = additional_info.items;
      const { uid } = metadata;

      const itemsPayed = items.map(({ id, unit_price, quantity }) => ({
        bookId: parseInt(id),
        price: parseInt(unit_price),
        quantity: parseInt(quantity),
      }));

      const updateStock = items.map(({ id, quantity }) => {
        return this.prismaService.book.update({
          where: { id: parseInt(id) },
          data: { stock: { decrement: parseInt(quantity) } },
        });
      });

      const order = this.prismaService.order.create({
        data: {
          customer: {
            connect: {
              id: uid,
            },
          },
          orderItems: {
            createMany: { data: itemsPayed },
          },
          totalPrice: transaction_amount,
        },
      });

      await this.prismaService.$transaction([...updateStock, order]);
    } catch (error) {
      throw new InternalServerErrorException('Internal Server Error');
    }
  }
}
