import express from 'express';
import { createOrder, getOrders,filterOrders, updateOrderProgress, updateOrder, deleteOrder } from '../controllers/orderController.js';

const router = express.Router();

router.post('/', createOrder); 
router.get('/', getOrders); 
router.get('/:orderType' , filterOrders)
router.patch('/update-progress' , updateOrderProgress)
router.put('/:id', updateOrder)
router.delete('/:orderNumber', deleteOrder);

export default router;
