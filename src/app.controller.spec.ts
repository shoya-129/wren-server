import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('root', () => {
    it('should send landing page HTML', () => {
      const res = {
        setHeader: jest.fn(),
        send: jest.fn(),
      } as any;
      appController.getLanding(res);
      expect(res.send).toHaveBeenCalled();
      expect(res.send.mock.calls[0][0]).toContain('<!DOCTYPE html>');
    });
  });
});
